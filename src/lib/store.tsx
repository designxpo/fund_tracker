"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { summarize, todayStr } from "@/lib/budget";
import type { Card, Category, Cycle, Settings, Spend } from "@/lib/types";

type Op = { kind: "upsert"; spend: Spend } | { kind: "delete"; id: string };

type Cache = { cards: Card[]; categories: Category[]; cycle: Cycle | null; spends: Spend[]; settings: Settings | null };

type Ctx = Cache & {
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
const NUMERIC = ["monthly_cap", "amount", "salary", "daily_budget"];
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

  const publish = useCallback(
    (patch?: Partial<Cache>) => {
      setData((d) => {
        const next = { ...d, ...patch, spends: overlay(base.current, outbox.current) };
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
        if (op.kind === "upsert" && !err) {
          base.current = [...base.current.filter((s) => s.id !== op.spend.id), op.spend];
        } else if (op.kind === "delete") {
          base.current = base.current.filter((s) => s.id !== op.id);
        }
      }
    } finally {
      flushing.current = false;
      publish();
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
        ]);
      let [c, k, y, st] = await fetchMeta();
      if (c.error || k.error || y.error) throw c.error ?? k.error ?? y.error;
      if (!c.data?.length || !y.data?.length) {
        seeding ??= Promise.resolve(sb.rpc("seed_defaults")).finally(() => (seeding = null));
        const { error: seedErr } = (await seeding) as { error: Error | null };
        if (seedErr) throw seedErr;
        [c, k, y, st] = await fetchMeta();
      }
      const cycle = y.data?.[0] ? (num<Cycle>(y.data[0])) : null;
      const sp = cycle
        ? await sb.from("spends").select("*").gte("spent_on", cycle.starts_on).order("created_at", { ascending: false }).limit(5000)
        : { data: [], error: null };
      if (sp.error) throw sp.error;
      base.current = (sp.data ?? []).map((r: Row) => num<Spend>(r));
      setError(null);
      publish({
        cards: (c.data ?? []).map((r: Row) => num<Card>(r)),
        categories: (k.data ?? []) as Category[],
        cycle,
        settings: (st.data as Settings | null) ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load data");
    }
  }, [publish]);

  // Boot: paint from cache instantly, then sync.
  useEffect(() => {
    const cached = read<Cache | null>(cacheKey, null);
    outbox.current = read<Op[]>(outboxKey, []);
    if (cached) {
      base.current = cached.spends;
      setData({ ...cached, spends: overlay(cached.spends, outbox.current) });
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

  const summary = useMemo(
    () => (data.cycle && today ? summarize(data.spends, data.cycle, today) : null),
    [data.cycle, data.spends, today],
  );

  const value = useMemo<Ctx>(
    () => ({ ...data, ready, today, pending, error, summary, addSpend, updateSpend, deleteSpend, restoreSpend, reload: load }),
    [data, ready, today, pending, error, summary, addSpend, updateSpend, deleteSpend, restoreSpend, load],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
