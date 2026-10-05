"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import { download, toCsv } from "@/lib/csv";
import { normalizePlan, type Goal, type PlanItem } from "@/lib/plan";
import { cycleEnd, diffDays } from "@/lib/budget";
import { addMonths, ymLabel } from "@/lib/planner";
import { inr } from "@/lib/money";

function Field({
  label,
  value,
  onCommit,
  numeric,
  type,
  className = "",
}: {
  label: string;
  value: string | number | null;
  onCommit: (v: string) => void;
  numeric?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block text-xs text-muted ${className}`}>
      {label}
      <input
        key={String(value)}
        type={type}
        inputMode={numeric ? "decimal" : undefined}
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const v = numeric ? e.target.value.replace(/[^\d.]/g, "") : e.target.value.trim();
          if (v !== String(value ?? "")) onCommit(v);
        }}
        className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink outline-none focus:border-mint"
      />
    </label>
  );
}

function CardSelect({
  label,
  value,
  cards,
  onChange,
}: {
  label: string;
  value: string | null;
  cards: { id: string; nickname: string }[];
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-2 text-base text-ink"
      >
        <option value="">None</option>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nickname}
          </option>
        ))}
      </select>
    </label>
  );
}

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
    {children}
  </section>
);

const toNum = (v: string) => (v === "" ? null : Number(v));

type SettingsGoal = Goal & { kind: "savings" | "sinking" | "buffer"; monthly_contribution: number | null; cycle_months: number | null; next_due_date: string | null };
type TemplateRow = { id: string; month: string; name: string; kind: PlanItem["kind"]; goal_id: string | null; planned: number; sort_order: number };
const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

export default function SettingsPage() {
  const { cycle, cards, categories, settings, reload: reloadStore, ready } = useStore();
  const toast = useToast();
  const sb = createClient();
  const [newCard, setNewCard] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newItem, setNewItem] = useState({ name: "", planned: "", kind: "fixed" as PlanItem["kind"], goal_id: "" });
  const [planMonth, setPlanMonth] = useState<string>("current"); // "current" or "YYYY-MM"

  const { data, reload } = useData(async () => {
    if (!cycle) return null;
    const [items, goals, templates] = await Promise.all([
      sb.from("plan_items").select("*").eq("cycle_id", cycle.id).not("kind", "in", "(bills,unspent,adjustment)").order("kind").order("name").then(ok),
      sb.from("goals").select("*").order("name").then(ok),
      sb.from("plan_templates").select("*").order("month").order("sort_order").then(ok),
    ]);
    return {
      items: (items as Record<string, unknown>[]).map(normalizePlan),
      goals: (goals as SettingsGoal[]).map((g) => ({
        ...g,
        target: g.target == null ? null : Number(g.target),
        monthly_contribution: g.monthly_contribution == null ? null : Number(g.monthly_contribution),
      })),
      templates: (templates as TemplateRow[]).map((t) => ({ ...t, month: String(t.month).slice(0, 7), planned: Number(t.planned) })),
    };
  }, cycle?.id);

  if (!ready || !cycle || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  async function save(fn: () => PromiseLike<{ error: { message: string } | null }>, msg = "Saved") {
    try {
      const { error } = await fn();
      if (error) throw new Error(error.message);
      await Promise.all([reloadStore(), reload()]);
      toast({ msg });
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't save" });
    }
  }

  async function saveSettings(patch: { birthday?: string | null; birthday_card_id?: string | null }) {
    await save(async () => {
      const upd = await sb.from("settings").update(patch).not("user_id", "is", null).select("user_id");
      if (upd.error || upd.data?.length) return { error: upd.error };
      return sb.from("settings").insert(patch);
    });
  }

  async function exportCsv() {
    const rows: (string | number | null)[][] = [["Date", "Amount", "Type", "Paid from", "Category", "Card", "Note"]];
    for (let from = 0; ; from += 1000) {
      const page = ok(await sb.from("spends").select("*").order("spent_on").order("created_at").range(from, from + 999)) as {
        spent_on: string; amount: number; spend_type: string; goal_id: string | null; category_id: string | null; card_id: string | null; note: string | null;
      }[];
      page.forEach((s) =>
        rows.push([
          s.spent_on,
          Number(s.amount),
          s.spend_type ?? "daily",
          data?.goals.find((g) => g.id === s.goal_id)?.name ?? "",
          categories.find((c) => c.id === s.category_id)?.name ?? "",
          cards.find((c) => c.id === s.card_id)?.nickname ?? "",
          s.note,
        ]),
      );
      if (page.length < 1000) break;
    }
    download(`spends-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast({ msg: `Exported ${rows.length - 1} spends` });
  }

  const { items, goals, templates } = data;

  // Month-specific plans: this cycle's plan, then each upcoming month's template.
  const cycleMonth = cycle.starts_on.slice(0, 7);
  const months = [...new Set(templates.map((t) => t.month))].filter((m) => m > cycleMonth).sort();
  const lastMonth = months.at(-1);
  const viewing = planMonth !== "current" && months.includes(planMonth) ? planMonth : "current";
  const rowsShown: { id: string; name: string; kind: PlanItem["kind"]; goal_id: string | null; planned: number }[] =
    viewing === "current" ? items : templates.filter((t) => t.month === viewing);
  const table = viewing === "current" ? "plan_items" : "plan_templates";
  const days = viewing === "current" ? diffDays(cycle.starts_on, cycleEnd(cycle.starts_on, cycle.ends_on)) + 1 : daysInMonth(viewing);
  const planSum = rowsShown.reduce((t, r) => t + r.planned, 0);
  const dailyReserve = Number(cycle.daily_budget) * days;
  const gap = Number(cycle.salary) - (planSum + dailyReserve);

  async function addMonthPlan() {
    const next = addMonths(lastMonth ?? cycleMonth, 1);
    const source = viewing === "current" ? items : rowsShown;
    await save(
      () =>
        sb.from("plan_templates").insert(
          source.map((r, i) => ({ month: `${next}-01`, name: r.name, kind: r.kind, goal_id: r.goal_id, planned: r.planned, sort_order: i + 1 })),
        ),
      `${ymLabel(next)} plan added`,
    );
    setPlanMonth(next);
  }

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Link href="/more" className="text-sm text-muted">‹ More</Link>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <Section title="Budget" hint="Applies to the current salary cycle.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly take-home (₹)" numeric value={cycle.salary} onCommit={(v) => save(() => sb.from("cycles").update({ salary: Number(v) }).eq("id", cycle.id))} />
          <Field label="Daily budget (₹)" numeric value={cycle.daily_budget} onCommit={(v) => save(() => sb.from("cycles").update({ daily_budget: Number(v) }).eq("id", cycle.id))} />
        </div>
      </Section>

      <Section title="Birthday" hint="Around your birthday (±1 day) Quick Add suggests this card for every category.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Birthday" type="date" value={settings?.birthday ?? ""} onCommit={(v) => saveSettings({ birthday: v || null })} />
          <CardSelect label="Birthday card" value={settings?.birthday_card_id ?? null} cards={cards} onChange={(id) => saveSettings({ birthday_card_id: id })} />
        </div>
      </Section>

      <Section title="Cards" hint="Nicknames only. Never enter card numbers.">
        {cards.map((c) => (
          <div key={c.id} className="space-y-2 rounded-xl border border-line p-3">
            <Field label="Nickname" value={c.nickname} onCommit={(v) => v && save(() => sb.from("cards").update({ nickname: v }).eq("id", c.id))} />
            <div className="grid grid-cols-3 gap-2">
              <Field label="Monthly cap ₹" numeric value={c.monthly_cap} onCommit={(v) => save(() => sb.from("cards").update({ monthly_cap: Number(v || 0) }).eq("id", c.id))} />
              <Field label="Statement day" numeric value={c.statement_day} onCommit={(v) => save(() => sb.from("cards").update({ statement_day: toNum(v) }).eq("id", c.id))} />
              <Field label="Due day" numeric value={c.due_day} onCommit={(v) => save(() => sb.from("cards").update({ due_day: toNum(v) }).eq("id", c.id))} />
            </div>
            <button onClick={() => confirm(`Remove ${c.nickname}? Past spends keep their history.`) && save(() => sb.from("cards").update({ active: false }).eq("id", c.id), "Card removed")} className="h-9 text-xs text-bad">
              Remove card
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={newCard} onChange={(e) => setNewCard(e.target.value)} placeholder="New card nickname" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />
          <button
            disabled={!newCard.trim()}
            onClick={async () => {
              await save(() => sb.from("cards").insert({ nickname: newCard.trim(), sort_order: cards.length + 1 }), "Card added");
              setNewCard("");
            }}
            className="h-11 rounded-xl bg-navy px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </Section>

      <Section title="Categories & card rules" hint="Suggested card is pre-selected in Quick Add. The small-amount card is used under ₹200.">
        {categories.map((c) => (
          <div key={c.id} className="space-y-2 rounded-xl border border-line p-3">
            <div className="grid grid-cols-[4rem_1fr] gap-2">
              <Field label="Icon" value={c.icon} onCommit={(v) => save(() => sb.from("categories").update({ icon: v || null }).eq("id", c.id))} />
              <Field label="Name" value={c.name} onCommit={(v) => v && save(() => sb.from("categories").update({ name: v }).eq("id", c.id))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CardSelect label="Suggested card" value={c.suggested_card_id} cards={cards} onChange={(id) => save(() => sb.from("categories").update({ suggested_card_id: id }).eq("id", c.id))} />
              <CardSelect label="Under ₹200" value={c.small_card_id} cards={cards} onChange={(id) => save(() => sb.from("categories").update({ small_card_id: id }).eq("id", c.id))} />
            </div>
            <button onClick={() => confirm(`Delete ${c.name}? Existing spends become uncategorised.`) && save(() => sb.from("categories").delete().eq("id", c.id), "Category deleted")} className="h-9 text-xs text-bad">
              Delete category
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />
          <button
            disabled={!newCat.trim()}
            onClick={async () => {
              await save(() => sb.from("categories").insert({ name: newCat.trim(), icon: "🏷️", sort_order: categories.length + 1 }), "Category added");
              setNewCat("");
            }}
            className="h-11 rounded-xl bg-navy px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </Section>

      <Section
        title="Monthly plan"
        hint="Each month can differ. On salary day the new cycle uses that month's plan; months without one copy the previous cycle. The last month's plan continues onward."
      >
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["current", ...months].map((m) => (
            <button
              key={m}
              onClick={() => setPlanMonth(m)}
              aria-pressed={viewing === m}
              className={`h-9 shrink-0 rounded-full px-3 text-sm font-medium ${viewing === m ? "bg-navy text-white" : "bg-white/60 text-muted"}`}
            >
              {m === "current" ? `This cycle (${ymLabel(cycleMonth)})` : `${ymLabel(m)}${m === lastMonth ? " →" : ""}`}
            </button>
          ))}
          <button onClick={addMonthPlan} className="h-9 shrink-0 rounded-full border border-dashed border-line px-3 text-sm text-muted">
            + {ymLabel(addMonths(lastMonth ?? cycleMonth, 1))}
          </button>
        </div>

        <p role="status" className={`rounded-xl px-3 py-2 text-xs ${Math.abs(gap) < 0.5 ? "bg-good/12 text-good" : "bg-warn/15 text-warn"}`}>
          Plan {inr(planSum)} + daily {inr(dailyReserve)} (₹{Number(cycle.daily_budget)} × {days} days) = {inr(planSum + dailyReserve)}.{" "}
          {Math.abs(gap) < 0.5 ? "Matches your salary ✓" : gap > 0 ? `${inr(gap)} short of ${inr(Number(cycle.salary))}.` : `${inr(-gap)} over ${inr(Number(cycle.salary))}.`}
        </p>

        <ul className="divide-y divide-line">
          {rowsShown.map((i) => (
            <li key={i.id} className="flex items-end gap-2 py-2">
              <span className="min-w-0 flex-1 pb-3 text-sm">
                {i.name}
                <span className="block text-xs text-muted">
                  {i.kind}
                  {i.goal_id ? ` → ${goals.find((g) => g.id === i.goal_id)?.name ?? "goal"}` : ""}
                </span>
              </span>
              <Field label="₹ / month" numeric value={i.planned} className="w-28" onCommit={(v) => save(() => sb.from(table).update({ planned: Number(v || 0) }).eq("id", i.id))} />
              <button aria-label={`Delete ${i.name}`} onClick={() => confirm(`Remove ${i.name} from this plan?`) && save(() => sb.from(table).delete().eq("id", i.id), "Removed")} className="h-11 w-9 text-muted">
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="New item" className="h-11 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />
          <input inputMode="decimal" value={newItem.planned} onChange={(e) => setNewItem({ ...newItem, planned: e.target.value.replace(/[^\d.]/g, "") })} placeholder="₹" className="h-11 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />
          <select value={newItem.kind} onChange={(e) => setNewItem({ ...newItem, kind: e.target.value as PlanItem["kind"] })} className="h-11 rounded-xl border border-line bg-bg px-2 text-base text-ink">
            <option value="fixed">Fixed cost</option>
            <option value="loan">EMI / loan</option>
            <option value="savings">Into a goal / fund</option>
          </select>
          <button
            disabled={!newItem.name.trim() || !newItem.planned || (newItem.kind === "savings" && !newItem.goal_id)}
            onClick={async () => {
              const row = { name: newItem.name.trim(), kind: newItem.kind, planned: Number(newItem.planned), goal_id: newItem.kind === "savings" ? newItem.goal_id : null };
              await save(
                () =>
                  viewing === "current"
                    ? sb.from("plan_items").insert({ ...row, cycle_id: cycle.id })
                    : sb.from("plan_templates").insert({ ...row, month: `${viewing}-01`, sort_order: rowsShown.length + 1 }),
                "Item added",
              );
              setNewItem({ name: "", planned: "", kind: "fixed", goal_id: "" });
            }}
            className="h-11 rounded-xl bg-navy text-sm font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
          {newItem.kind === "savings" && (
            <select value={newItem.goal_id} onChange={(e) => setNewItem({ ...newItem, goal_id: e.target.value })} className="col-span-2 h-11 rounded-xl border border-line bg-bg px-2 text-base text-ink">
              <option value="">Which goal or fund?</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {viewing !== "current" && (
          <button
            onClick={() =>
              confirm(`Delete the ${ymLabel(viewing)} plan? That month will copy the previous cycle instead.`) &&
              save(() => sb.from("plan_templates").delete().eq("month", `${viewing}-01`), "Month plan deleted").then(() => setPlanMonth("current"))
            }
            className="h-9 text-xs text-bad"
          >
            Delete {ymLabel(viewing)} plan
          </button>
        )}
      </Section>

      <Section title="Goal targets">
        <div className="grid grid-cols-2 gap-3">
          {goals
            .filter((g) => g.kind !== "sinking")
            .map((g) => (
              <Field key={g.id} label={`${g.name} (₹)`} numeric value={g.target} onCommit={(v) => save(() => sb.from("goals").update({ target: toNum(v) }).eq("id", g.id))} />
            ))}
        </div>
      </Section>

      {goals.some((g) => g.kind === "sinking") && (
        <Section title="Sinking funds" hint="Saved monthly for a bulk buy every few months. Logging a Planned spend moves the due date forward.">
          {goals
            .filter((g) => g.kind === "sinking")
            .map((g) => (
              <div key={g.id} className="space-y-2 rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">{g.name}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Per month (₹)" numeric value={g.monthly_contribution} onCommit={(v) => save(() => sb.from("goals").update({ monthly_contribution: toNum(v) }).eq("id", g.id))} />
                  <Field label="Every (months)" numeric value={g.cycle_months} onCommit={(v) => save(() => sb.from("goals").update({ cycle_months: toNum(v) }).eq("id", g.id))} />
                  <Field label="Bulk buy (₹)" numeric value={g.target} onCommit={(v) => save(() => sb.from("goals").update({ target: toNum(v) }).eq("id", g.id))} />
                  <Field label="Next due" type="date" value={g.next_due_date ?? ""} onCommit={(v) => save(() => sb.from("goals").update({ next_due_date: v || null }).eq("id", g.id))} />
                </div>
              </div>
            ))}
        </Section>
      )}

      <Section title="Data">
        <button onClick={exportCsv} className="h-12 w-full rounded-xl border border-line text-sm font-medium">
          Export all spends (CSV)
        </button>
      </Section>
    </div>
  );
}
