"use client";

import { inr } from "@/lib/money";
import { sumBetween } from "@/lib/budget";
import { OutsideBudget } from "@/components/outside-budget";
import type { Card, StoreSettlement } from "@/lib/types";

type PrevSpend = { amount: number; card_id: string | null; spent_on: string; spend_type?: string };

/** Step 1: pay last cycle's card bills in full: per card, full total, and the split by spend type. */
export function CardBillStep({
  cards,
  prev,
  prevSpends,
  bill,
  onPaid,
}: {
  cards: Card[];
  prev: { starts_on: string; ends_on: string } | undefined;
  prevSpends: PrevSpend[];
  bill: StoreSettlement | undefined;
  onPaid: (done: boolean) => void;
}) {
  const credit = cards.filter((c) => c.monthly_cap > 0);
  const ids = new Set(credit.map((c) => c.id));
  const onCards = prevSpends.filter((x) => x.card_id && ids.has(x.card_id));
  const byType = (t: string) => onCards.filter((x) => (x.spend_type ?? "daily") === t).reduce((a, x) => a + x.amount, 0);
  const total = onCards.reduce((a, x) => a + x.amount, 0);

  return (
    <>
      {prev ? (
        <div className="mb-2 mt-2 text-xs text-muted">
          <ul className="space-y-1">
            {credit.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{c.nickname}</span>
                <span className="tabular-nums">{inr(sumBetween(prevSpends, prev.starts_on, prev.ends_on, c.id))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold text-ink">
            <span>Full card bill</span>
            <span className="tabular-nums">{inr(total)}</span>
          </p>
          <p>
            Daily {inr(byType("daily"))} · Planned {inr(byType("planned"))} (paid from funds) · Unplanned {inr(byType("unplanned"))} (from buffer)
          </p>
          {bill && (
            <label className="mt-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={bill.done} onChange={(e) => onPaid(e.target.checked)} className="h-5 w-5 accent-[var(--good)]" />
              Paid the bills in full
            </label>
          )}
        </div>
      ) : (
        <p className="mb-2 mt-1 text-xs text-muted">Your first cycle: no previous card bills to show.</p>
      )}
      <div className="mb-2">
        <OutsideBudget showTotals={false} />
      </div>
    </>
  );
}
