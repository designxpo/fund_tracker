"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import { download, toCsv } from "@/lib/csv";
import { normalizePlan, type Goal, type PlanItem } from "@/lib/plan";

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

export default function SettingsPage() {
  const { cycle, cards, categories, settings, reload: reloadStore, ready } = useStore();
  const toast = useToast();
  const sb = createClient();
  const [newCard, setNewCard] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newItem, setNewItem] = useState({ name: "", planned: "", kind: "fixed" as PlanItem["kind"] });

  const { data, reload } = useData(async () => {
    if (!cycle) return null;
    const [items, goals] = await Promise.all([
      sb.from("plan_items").select("*").eq("cycle_id", cycle.id).not("kind", "in", "(bills,unspent)").order("kind").order("name").then(ok),
      sb.from("goals").select("*").order("name").then(ok),
    ]);
    return {
      items: (items as Record<string, unknown>[]).map(normalizePlan),
      goals: (goals as Goal[]).map((g) => ({ ...g, target: g.target == null ? null : Number(g.target) })),
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
    const rows: (string | number | null)[][] = [["Date", "Amount", "Category", "Card", "Note"]];
    for (let from = 0; ; from += 1000) {
      const page = ok(await sb.from("spends").select("*").order("spent_on").order("created_at").range(from, from + 999)) as {
        spent_on: string; amount: number; category_id: string | null; card_id: string | null; note: string | null;
      }[];
      page.forEach((s) =>
        rows.push([s.spent_on, Number(s.amount), categories.find((c) => c.id === s.category_id)?.name ?? "", cards.find((c) => c.id === s.card_id)?.nickname ?? "", s.note]),
      );
      if (page.length < 1000) break;
    }
    download(`spends-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast({ msg: `Exported ${rows.length - 1} spends` });
  }

  const { items, goals } = data;

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

      <Section title="Monthly plan" hint="This cycle's plan. Future cycles copy it; scheduled changes (e.g. from Dec 2026) are applied on salary day.">
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="flex items-end gap-2 py-2">
              <span className="min-w-0 flex-1 pb-3 text-sm">
                {i.name}
                <span className="block text-xs text-muted">{i.kind}</span>
              </span>
              <Field label="₹ / month" numeric value={i.planned} className="w-28" onCommit={(v) => save(() => sb.from("plan_items").update({ planned: Number(v || 0) }).eq("id", i.id))} />
              <button aria-label={`Delete ${i.name}`} onClick={() => confirm(`Remove ${i.name} from this plan?`) && save(() => sb.from("plan_items").delete().eq("id", i.id), "Removed")} className="h-11 w-9 text-muted">
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
          </select>
          <button
            disabled={!newItem.name.trim() || !newItem.planned}
            onClick={async () => {
              await save(() => sb.from("plan_items").insert({ cycle_id: cycle.id, name: newItem.name.trim(), kind: newItem.kind, planned: Number(newItem.planned) }), "Item added");
              setNewItem({ name: "", planned: "", kind: "fixed" });
            }}
            className="h-11 rounded-xl bg-navy text-sm font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </Section>

      <Section title="Goal targets">
        <div className="grid grid-cols-2 gap-3">
          {goals.map((g) => (
            <Field key={g.id} label={`${g.name} (₹)`} numeric value={g.target} onCommit={(v) => save(() => sb.from("goals").update({ target: toNum(v) }).eq("id", g.id))} />
          ))}
        </div>
      </Section>

      <Section title="Data">
        <button onClick={exportCsv} className="h-12 w-full rounded-xl border border-line text-sm font-medium">
          Export all spends (CSV)
        </button>
      </Section>
    </div>
  );
}
