"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { ok, useData } from "@/lib/use-data";
import { inr } from "@/lib/money";

export function BudgetCaps() {
  const { today, spends, categories } = useStore();
  const month = today.slice(0, 7);
  const { data, error } = useData("category-month-caps", async () =>
    ok(await createClient().from("category_month_caps").select("category_id,amount").eq("month", `${month}-01`)) as { category_id: string; amount: number }[], month);
  const over = (data ?? []).map(cap => ({
    name: categories.find(c => c.id === cap.category_id)?.name ?? "Category",
    excess: spends.filter(s => s.spent_on.slice(0, 7) === month && s.category_id === cap.category_id).reduce((t, s) => t + s.amount, 0) - Number(cap.amount),
  })).filter(c => c.excess > 0);
  return <Link href="/budget" className="block space-y-1 rounded-2xl bg-surface px-4 py-3">
    <span className="flex items-center justify-between text-sm font-semibold"><span>Budget & spending caps</span><span aria-hidden>→</span></span>
    <span className="block text-xs text-muted">{error ? "Category caps unavailable. Open budget to retry." : "Set this month’s daily limit, category caps and next month’s plan."}</span>
    {over.map(c => <span key={c.name} className="block text-xs font-medium text-bad">{c.name}: {inr(c.excess)} over cap</span>)}
  </Link>;
}
