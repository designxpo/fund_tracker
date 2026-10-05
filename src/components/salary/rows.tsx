"use client";

import { inr } from "@/lib/money";
import type { StoreGoal, StorePlanItem, StoreSettlement } from "@/lib/types";

const amountOf = (i: StorePlanItem) => Number(i.actual ?? i.planned);

/** A checklist line: tick it and/or type the actual amount. */
export function PlanRow({
  item,
  onToggle,
  onActual,
}: {
  item: StorePlanItem;
  onToggle: (done: boolean) => void;
  onActual: (value: number | null) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Mark ${item.name} done`}
        className="h-6 w-6 shrink-0 accent-[var(--good)]"
      />
      <span className={`min-w-0 flex-1 text-sm ${item.done ? "text-muted line-through" : ""}`}>
        {item.name}
        <span className="block text-xs text-muted">planned {inr(item.planned)}</span>
      </span>
      <span className="text-muted">₹</span>
      <input
        key={`${item.id}-${item.actual}`}
        inputMode="decimal"
        defaultValue={item.actual ?? ""}
        placeholder={String(item.planned)}
        onBlur={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          const v = raw === "" ? null : Number(raw);
          if (v !== item.actual && (v === null || Number.isFinite(v))) onActual(v);
        }}
        aria-label={`Actual amount for ${item.name}`}
        className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right text-base tabular-nums outline-none focus:border-mint"
      />
    </li>
  );
}

/** Last cycle's daily-budget result: pick where it goes (or is borrowed from), then tick. */
export function DailyResultRow({
  s,
  goals,
  onGoal,
  onToggle,
}: {
  s: StoreSettlement;
  goals: StoreGoal[];
  onGoal: (goalId: string) => void;
  onToggle: (done: boolean) => void;
}) {
  const negative = s.amount < 0;
  return (
    <li className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={s.done}
        disabled={s.amount !== 0 && !s.goal_id}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Mark ${s.note ?? "daily result"} done`}
        className="mt-1 h-6 w-6 shrink-0 accent-[var(--good)]"
      />
      <span className={`min-w-0 flex-1 text-sm ${s.done ? "text-muted" : ""}`}>
        {s.note}
        <span className={`block text-xs ${negative ? "text-bad" : "text-good"}`}>{negative ? `overspent ${inr(-s.amount)}` : `left ${inr(s.amount)}`}</span>
        {s.amount !== 0 && (
          <select
            value={s.goal_id ?? ""}
            disabled={s.done}
            onChange={(e) => onGoal(e.target.value)}
            aria-label={negative ? "Borrow the overspend from" : "Move what's left to"}
            className="mt-1 h-9 w-full rounded-lg border border-line bg-white/80 px-2 text-sm text-ink"
          >
            <option value="">{negative ? "Borrow from…" : "Move to…"}</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({inr(Math.round(g.available))} free)
              </option>
            ))}
          </select>
        )}
      </span>
    </li>
  );
}

/** A leftover moved / shortfall borrowed this month, with undo. */
export function MoveRow({ s, onUndo }: { s: StoreSettlement; onUndo: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span>{s.note}</span>
      <span className="flex items-center gap-2">
        <b className={`tabular-nums ${s.amount < 0 ? "text-bad" : "text-good"}`}>
          {s.amount < 0 ? "−" : "+"}
          {inr(Math.abs(s.amount))}
        </b>
        <button onClick={onUndo} aria-label={`Undo ${s.note}`} className="h-9 w-9 text-muted">
          ✕
        </button>
      </span>
    </li>
  );
}

export { amountOf };
