"use client";

import { useState } from "react";
import { GOAL_ICONS, PRIORITY } from "@/lib/planner-data";

export type GoalInput = {
  name: string;
  icon: string;
  target: string;
  saved: string;
  target_date: string;
  priority: 1 | 2 | 3;
};

const digits = (v: string) => v.replace(/[^\d.]/g, "");
const input = "mt-1 h-12 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink outline-none focus:border-mint";

export function GoalForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<GoalInput>;
  submitLabel: string;
  onSubmit: (g: GoalInput) => Promise<void>;
}) {
  const [g, setG] = useState<GoalInput>({
    name: "",
    icon: "🎯",
    target: "",
    saved: "",
    target_date: "",
    priority: 2,
    ...initial,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<GoalInput>) => setG((cur) => ({ ...cur, ...patch }));
  const valid = g.name.trim() && Number(g.target) > 0;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        await onSubmit(g);
        setBusy(false);
      }}
      className="space-y-4 rounded-2xl bg-surface p-4 shadow-sm"
    >
      <label className="block text-xs text-muted">
        What do you want to buy?
        <input autoFocus value={g.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. iPhone 17, Royal Enfield, Goa trip" className={input} />
      </label>

      <div>
        <p className="text-xs text-muted">Icon</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {GOAL_ICONS.map((i) => (
            <button
              type="button"
              key={i}
              onClick={() => set({ icon: i })}
              aria-pressed={g.icon === i}
              className={`grid h-11 w-11 place-items-center rounded-xl text-xl ${g.icon === i ? "bg-navy" : "bg-bg"}`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          Price (₹)
          <input inputMode="decimal" value={g.target} onChange={(e) => set({ target: digits(e.target.value) })} placeholder="80000" className={input} />
        </label>
        <label className="block text-xs text-muted">
          Already saved (₹)
          <input inputMode="decimal" value={g.saved} onChange={(e) => set({ saved: digits(e.target.value) })} placeholder="0" className={input} />
        </label>
      </div>

      <label className="block text-xs text-muted">
        Want it by (optional)
        <input type="date" value={g.target_date} onChange={(e) => set({ target_date: e.target.value })} className={input} />
      </label>

      <div>
        <p className="text-xs text-muted">Priority (higher gets free money first)</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {([1, 2, 3] as const).map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => set({ priority: p })}
              aria-pressed={g.priority === p}
              className={`h-11 rounded-xl text-sm font-medium ${g.priority === p ? "bg-navy text-white" : "bg-bg text-muted"}`}
            >
              {PRIORITY[p]}
            </button>
          ))}
        </div>
      </div>

      <button disabled={!valid || busy} className="h-12 w-full rounded-xl bg-mint font-semibold text-navy disabled:opacity-40">
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
