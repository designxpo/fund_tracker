"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { useQuickAdd } from "@/components/quick-add";
import { useToast } from "@/components/toast";
import { addDays, parseYmd, ymd } from "@/lib/budget";
import { inr } from "@/lib/money";
import type { Card, Spend } from "@/lib/types";

const shortDate = (d: string) => parseYmd(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Day after the card's last statement date (when the bank's "unbilled" amount starts), or the cycle start. */
function lastStatementStart(card: Card, today: string, fallback: string) {
  if (!card.statement_day) return fallback;
  const t = parseYmd(today);
  const on = (y: number, m: number) => ymd(new Date(y, m, Math.min(card.statement_day!, new Date(y, m + 1, 0).getDate())));
  const thisMonth = on(t.getFullYear(), t.getMonth());
  return addDays(thisMonth < today ? thisMonth : on(t.getFullYear(), t.getMonth() - 1), 1);
}

/**
 * Match a card with the bank: type what the bank app shows for a period, see what the app has
 * for the same dates, and fix the gap: tap a spend to correct it, or add the difference.
 */
export function CardMatch({ card, onClose }: { card: Card; onClose: () => void }) {
  const { spends, today, summary, addSpend } = useStore();
  const { open } = useQuickAdd();
  const toast = useToast();
  const [since, setSince] = useState(() => lastStatementStart(card, today, summary?.cycle.start ?? today));
  const [bank, setBank] = useState("");

  // The store holds this salary cycle; anything before it is fetched (read-only here).
  const cycleStart = summary?.cycle.start ?? today;
  const { data: older, loading } = useData(
    "card-match",
    async () =>
      since >= cycleStart
        ? []
        : (ok(await createClient().from("spends").select("*").eq("card_id", card.id).gte("spent_on", since).lt("spent_on", cycleStart).order("spent_on", { ascending: false })) as Spend[]).map(
            (s) => ({ ...s, amount: Number(s.amount) }),
          ),
    `${card.id}:${since}:${cycleStart}`,
  );
  const current = spends.filter((s) => s.card_id === card.id && s.spent_on >= since && s.spent_on >= cycleStart && s.spent_on <= today);
  const list = [...current, ...(older ?? [])];
  const app = list.reduce((t, s) => t + Number(s.amount), 0);
  const editable = new Set(current.map((s) => s.id));
  const bankAmt = parseFloat(bank);
  const diff = Number.isFinite(bankAmt) ? Math.round((bankAmt - app) * 100) / 100 : null;

  const addDiff = () => {
    if (diff == null || diff === 0) return;
    addSpend({
      amount: diff,
      category_id: null,
      card_id: card.id,
      note: diff > 0 ? `Matched with bank: missing spends since ${shortDate(since)}` : `Matched with bank: refund/credit since ${shortDate(since)}`,
      spent_on: today,
      spend_type: "daily",
      goal_id: null,
      fund_settle: "now",
      fund_settled_on: null,
    });
    toast({ msg: diff > 0 ? `Added ${inr(diff)} to ${card.nickname}` : `Added ${inr(-diff)} refund on ${card.nickname}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(15,23,48,.22)]" />
      <div role="dialog" aria-label={`Match ${card.nickname} with your bank`} className="glass-chrome absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] max-w-md flex-col rounded-t-[32px]">
        <div className="overflow-y-auto px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink/15" />
          <h2 className="text-lg font-semibold">Match {card.nickname} with your bank</h2>
          <p className="text-sm text-muted">Type what your bank app shows for these dates. Refunds and credits lower it.</p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-muted">
              Spends since
              <input
                type="date"
                value={since}
                max={today}
                onChange={(e) => setSince(e.target.value || since)}
                className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink"
              />
            </label>
            <label className="text-xs text-muted">
              Bank shows (₹)
              <input
                inputMode="decimal"
                autoFocus
                placeholder="0"
                value={bank}
                onChange={(e) => setBank(e.target.value.replace(/[^\d.]/g, ""))}
                className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink"
              />
            </label>
          </div>
          {card.statement_day && <p className="mt-1 text-xs text-muted">Starts the day after your last statement (the {card.statement_day}th), like the bank&apos;s unbilled amount.</p>}

          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-bg p-2.5">
              <dt className="text-xs text-muted">In the app</dt>
              <dd className="font-semibold tabular-nums">{loading && since < cycleStart ? "…" : inr(app)}</dd>
            </div>
            <div className={`rounded-xl p-2.5 ${diff == null || Math.abs(diff) < 1 ? "bg-bg" : "bg-warn/10"}`}>
              <dt className="text-xs text-muted">Difference</dt>
              <dd className="font-semibold tabular-nums">
                {diff == null ? "—" : Math.abs(diff) < 1 ? "Matches ✓" : diff > 0 ? `Bank ${inr(diff)} higher` : `Bank ${inr(-diff)} lower`}
              </dd>
            </div>
          </dl>

          {diff != null && Math.abs(diff) >= 1 && (
            <div className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">
              <p>
                {diff > 0
                  ? "A spend is missing or was logged for less. Find it below and fix it, or add the difference as one spend."
                  : "A refund or credit isn't in the app, or a spend was logged twice or for more. Fix it below, or add the difference as a refund."}
              </p>
              <button onClick={addDiff} className="mt-2 h-11 w-full rounded-full bg-navy text-sm font-semibold text-white">
                {diff > 0 ? `Add ${inr(diff)} as a spend` : `Add ${inr(-diff)} as a refund`}
              </button>
            </div>
          )}

          <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
            {list.length} entries since {shortDate(since)} · tap one to edit
          </h3>
          <ul className="mt-1 divide-y divide-line text-sm">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  disabled={!editable.has(s.id)}
                  onClick={() => {
                    onClose();
                    open(s);
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left disabled:opacity-60"
                >
                  <span className="truncate">
                    {shortDate(s.spent_on)}
                    {s.note ? ` · ${s.note}` : ""}
                    {s.spend_type && s.spend_type !== "daily" ? ` · ${s.spend_type}` : ""}
                  </span>
                  <span className={`shrink-0 tabular-nums ${s.amount < 0 ? "text-good" : ""}`}>{s.amount < 0 ? `+${inr(-s.amount)}` : inr(s.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
          {since < cycleStart && <p className="mt-1 text-xs text-muted">Faded entries are from before this salary cycle: counted here, edit them by adding a refund or spend today.</p>}
          <button onClick={onClose} className="mt-3 h-11 w-full rounded-full border border-line text-sm font-medium text-muted">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
