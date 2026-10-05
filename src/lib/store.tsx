"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { summarize, todayStr } from "@/lib/budget";
import { isDaily, isOwed, type Card, type Category, type Cycle, type Settings, type Spend, type StoreGoal, type StorePlanItem } from "@/lib/types";

type Op = { kind: "upsert"; spend: Spend } | { kind: "delete"; id: string };

type Cache = {
  cards: Card[];
  categories: Category[];
  cycle: Cycle | null;
  spends: Spend[];
  settings: Settings | null;
  goals?: Omit<StoreGoal, "balance">[];
  planItems?: StorePlanItem[];
  /** goal id → money moved by planned/unplanned spends still waiting to sync */
  pendingGoalDelta?: Record<string, number>;
  /** owed spends from before this cycle (current-cycle ones are in `spends`) */
  olderOwed?: Spend[];
};

type Ctx = Omit<Cache, "goals" | "planItems" | "pendingGoalDelta" | "olderOwed"> & {
  /** Planned/unplanned card spends waiting for their fund to pay (any date). */
  owedSpends: Spend[];
  /** Fund pays for it now (on paying the card bill). */
  settleSpends: (spends: Spend[]) => void;
  goals: StoreGoal[];
  /** Current cycle's plan. */
  planItems: StorePlanItem[];
  /** Only spends that count toward the daily/weekly budget and card caps. */
  dailySpends: Spend[];
  ready: boolean;
  today: string;
  pending: number;
  error: string | null;
  summary: ReturnType<typeof summarize> | null;
  addSpend: (s: Omit<Spend, "id" | "created_at">) => Spend;
  updateSpend: (id: string, patch: Partial<Omit<Spend, "id" | "created_at">>) => void;
  deleteSpend: (id: string) => Spend | undefined;
  restoreSpend: (s: Spend) => void;
  /** Re-fetch cards, categories, cycle, settings and spends (after edits elsewhere). */
  reload: () => Promise<void>;
};

// React strict mode / fast remounts can fire two loads at once; share one seed call.
let seeding: Promise<unknown> | null = null;

const StoreCtx = createContext<Ctx | null>(null);
export const useStore = () => {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside provider");
  return c;
};

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

/** How unsynced ops change each fund: −amount for a new planned/unplanned spend, reversed for edits/deletes. */
function goalDelta(base: Spend[], ops: Op[], current: Spend[]): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (sp: Spend | undefined, sign: number) => {
    if (sp && !isDaily(sp) && sp.goal_id && sp.fund_settle !== "bill") out[sp.goal_id] = (out[sp.goal_id] ?? 0) + sign * Number(sp.amount);
  };
  const ids = new Set(ops.map((o) => (o.kind === "upsert" ? o.spend.id : o.id)));
  ids.forEach((id) => {
    add(current.find((x) => x.id === id), -1);
    add(base.find((x) => x.id === id), +1);
  });
  return out;
}

/** Apply queued, not-yet-synced ops on top of what the server returned. */
function overlay(spends: Spend[], ops: Op[]): Spend[] {
  const map = new Map(spends.map((s) => [s.id, s]));
  for (const op of ops) {
    if (op.kind === "upsert") map.set(op.spend.id, op.spend);
    else map.delete(op.id);
  }
  return [...map.values()].sort((a, b) =>
    a.spent_on === b.spent_on ? (a.created_at < b.created_at ? 1 : -1) : a.spent_on < b.spent_on ? 1 : -1,
  );
}

// PostgREST can return numeric columns as strings; normalise them.
type Row = Record<string, unknown>;
const NUMERIC = ["monthly_cap", "amount", "salary", "daily_budget", "planned", "actual", "target", "monthly_contribution", "opening_balance"];
const num = <T,>(r: Row): T =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, NUMERIC.includes(k) && v != null ? Number(v) : v])) as T;

export function StoreProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const cacheKey = `spends:v1:${userId}`;
  const outboxKey = `spends:outbox:${userId}`;

  const [data, setData] = useState<Cache>({ cards: [], categories: [], cycle: null, spends: [], settings: null });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");

  const base = useRef<Spend[]>([]); // last server snapshot (without outbox)
  const outbox = useRef<Op[]>([]);
  const flushing = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const publish = useCallback(
    (patch?: Partial<Cache>) => {
      setData((d) => {
        const spends = overlay(base.current, outbox.current);
        const next = { ...d, ...patch, spends, pendingGoalDelta: goalDelta(base.current, outbox.current, spends) };
        write(cacheKey, next);
        return next;
      });
      setPending(outbox.current.length);
    },
    [cacheKey],
  );

  const saveOutbox = useCallback(() => write(outboxKey, outbox.current), [outboxKey]);

  const flush = useCallback(async () => {
    if (flushing.current || !outbox.current.length) return;
    flushing.current = true;
    const sb = createClient();
    let synced = 0;
    try {
      while (outbox.current.length && navigator.onLine) {
        const op = outbox.current[0];
        const { error: err } =
          op.kind === "upsert"
            ? await sb.from("spends").upsert(op.spend, { onConflict: "id" })
            : await sb.from("spends").delete().eq("id", op.id);
        // Errors with a code come from Postgres/PostgREST (a real rejection); anything else is the network.
        if (err && !("code" in err && err.code)) break;
        if (err) setError(err.message);
        outbox.current.shift();
        saveOutbox();
        synced++;
        if (op.kind === "upsert" && !err) {
          base.current = [...base.current.filter((s) => s.id !== op.spend.id), op.spend];
        } else if (op.kind === "delete") {
          base.current = base.current.filter((s) => s.id !== op.id);
        }
      }
    } finally {
      flushing.current = false;
      publish();
      if (synced) void loadRef.current();
    }
  }, [publish, saveOutbox]);

  const load = useCallback(async () => {
    if (!navigator.onLine) return;
    const sb = createClient();
    try {
      const fetchMeta = () =>
        Promise.all([
          sb.from("cards").select("*").eq("active", true).order("sort_order"),
          sb.from("categories").select("*").order("sort_order"),
          sb.from("cycles").select("*").is("ends_on", null).order("starts_on", { ascending: false }).limit(1),
          sb.from("settings").select("birthday, birthday_card_id").maybeSingle(),
          sb.from("goals").select("id, name, kind, is_custom, target, opening_balance, monthly_contribution, cycle_months, next_due_date"),
          sb.from("goal_transactions").select("goal_id, amount"),
        ]);
      let [c, k, y, st, g, tx] = await fetchMeta();
      if (c.error || k.error || y.error) throw c.error ?? k.error ?? y.error;
      if (!c.data?.length || !y.data?.length) {
        seeding ??= Promise.resolve(sb.rpc("seed_defaults")).finally(() => (seeding = null));
        const { error: seedErr } = (await seeding) as { error: Error | null };
        if (seedErr) throw seedErr;
        [c, k, y, st, g, tx] = await fetchMeta();
      }
      const cycle = y.data?.[0] ? (num<Cycle>(y.data[0])) : null;
      const sp = cycle
        ? await sb.from("spends").select("*").gte("spent_on", cycle.starts_on).order("created_at", { ascending: false }).limit(5000)
        : { data: [], error: null };
      if (sp.error) throw sp.error;
      base.current = (sp.data ?? []).map((r: Row) => num<Spend>(r));

      const txSum = new Map<string, number>();
      ((tx.data ?? []) as { goal_id: string; amount: unknown }[]).forEach((t) =>
        txSum.set(t.goal_id, (txSum.get(t.goal_id) ?? 0) + Number(t.amount)),
      );
      const goals = ((g.data ?? []) as Row[]).map((r) => {
        const row = num<Omit<StoreGoal, "balance" | "serverBalance"> & { opening_balance: number }>(r);
        const { opening_balance, ...rest } = row;
        return { ...rest, serverBalance: Number(opening_balance ?? 0) + (txSum.get(row.id) ?? 0) };
      });
      const owedOld = cycle
        ? await sb.from("spends").select("*").eq("fund_settle", "bill").lt("spent_on", cycle.starts_on)
        : { data: [], error: null };
      const pi = cycle
        ? await sb.from("plan_items").select("id, name, kind, goal_id, planned, actual, done").eq("cycle_id", cycle.id)
        : { data: [], error: null };
      setError(null);
      publish({
        cards: (c.data ?? []).map((r: Row) => num<Card>(r)),
        categories: (k.data ?? []) as Category[],
        cycle,
        settings: (st.data as Settings | null) ?? null,
        goals,
        planItems: ((pi.data ?? []) as Row[]).map((r) => num<StorePlanItem>(r)),
        olderOwed: ((owedOld.data ?? []) as Row[]).map((r) => num<Spend>(r)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load data");
    }
  }, [publish]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Boot: paint from cache instantly, then sync.
  useEffect(() => {
    const cached = read<Cache | null>(cacheKey, null);
    outbox.current = read<Op[]>(outboxKey, []);
    if (cached) {
      base.current = cached.spends;
      const spends = overlay(cached.spends, outbox.current);
      setData({ ...cached, spends, pendingGoalDelta: goalDelta(cached.spends, outbox.current, spends) });
    }
    setToday(todayStr());
    setPending(outbox.current.length);
    setReady(true);
    flush().then(load);

    const onOnline = () => flush().then(load);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setToday(todayStr());
      flush().then(load);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cacheKey, outboxKey, flush, load]);

  const enqueue = useCallback(
    (op: Op) => {
      outbox.current.push(op);
      saveOutbox();
      publish();
      void flush();
    },
    [flush, publish, saveOutbox],
  );

  const addSpend: Ctx["addSpend"] = useCallback(
    (s) => {
      const spend: Spend = { ...s, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      enqueue({ kind: "upsert", spend });
      return spend;
    },
    [enqueue],
  );

  const updateSpend: Ctx["updateSpend"] = useCallback(
    (id, patch) => {
      const cur = overlay(base.current, outbox.current).find((s) => s.id === id);
      if (cur) enqueue({ kind: "upsert", spend: { ...cur, ...patch } });
    },
    [enqueue],
  );

  const deleteSpend: Ctx["deleteSpend"] = useCallback(
    (id) => {
      const cur = overlay(base.current, outbox.current).find((s) => s.id === id);
      enqueue({ kind: "delete", id });
      return cur;
    },
    [enqueue],
  );

  const restoreSpend: Ctx["restoreSpend"] = useCallback((s) => enqueue({ kind: "upsert", spend: s }), [enqueue]);

  const dailySpends = useMemo(() => data.spends.filter(isDaily), [data.spends]);

  const summary = useMemo(
    () => (data.cycle && today ? summarize(dailySpends, data.cycle, today) : null),
    [data.cycle, dailySpends, today],
  );

  const owedSpends = useMemo(
    () => [...(data.olderOwed ?? []).filter((o) => !data.spends.some((s) => s.id === o.id)), ...data.spends].filter(isOwed),
    [data.olderOwed, data.spends],
  );

  // Goal balances = server balance + unsynced effects; "available" also sets aside what the fund owes on card bills.
  const goals = useMemo<StoreGoal[]>(
    () =>
      (data.goals ?? []).map((g) => {
        const balance = g.serverBalance + (data.pendingGoalDelta?.[g.id] ?? 0);
        const owed = owedSpends.filter((s) => s.goal_id === g.id).reduce((t, s) => t + Number(s.amount), 0);
        return { ...g, balance, owed, available: balance - owed };
      }),
    [data.goals, data.pendingGoalDelta, owedSpends],
  );

  const settleSpends: Ctx["settleSpends"] = useCallback(
    (list) => {
      const on = todayStr();
      list.forEach((s) => enqueue({ kind: "upsert", spend: { ...s, fund_settle: "now", fund_settled_on: on } }));
      // older owed spends aren't in the cycle list; drop them locally until the reload
      setData((d) => ({ ...d, olderOwed: (d.olderOwed ?? []).filter((o) => !list.some((x) => x.id === o.id)) }));
    },
    [enqueue],
  );

  const value = useMemo<Ctx>(
    () => ({
      ...data,
      goals,
      owedSpends,
      settleSpends,
      planItems: data.planItems ?? [],
      dailySpends,
      ready,
      today,
      pending,
      error,
      summary,
      addSpend,
      updateSpend,
      deleteSpend,
      restoreSpend,
      reload: load,
    }),
    [data, goals, owedSpends, settleSpends, dailySpends, ready, today, pending, error, summary, addSpend, updateSpend, deleteSpend, restoreSpend, load],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
