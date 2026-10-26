"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useQuickAdd } from "@/components/quick-add";
import { useToast } from "@/components/toast";
import { CardStrip } from "@/components/card-strip";
import { MonthCard, OverLimits, TodayCard } from "@/components/money-overview";
import { SpendRow } from "@/components/spend-row";
import Link from "next/link";
import { addDays, billsDueSoon, ordinal, parseYmd, salaryPromptDue, sinkingDueSoon } from "@/lib/budget";
import { inr } from "@/lib/money";

/** Sync errors in plain words (the database's own message otherwise). */
const friendly = (msg: string) =>
  msg.includes("spends_amount_check")
    ? "Refunds aren't switched on in your database yet. It's kept safe on this phone: tap Retry once they are."
    : msg;

function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const u = () => setOn(navigator.onLine);
    u();
    window.addEventListener("online", u);
    window.addEventListener("offline", u);
    return () => {
      window.removeEventListener("online", u);
      window.removeEventListener("offline", u);
    };
  }, []);
  return on;
}

export default function HomePage() {
  const { ready, summary, spends, today, cards, categories, cycle, goals, pending, error, failed, retryFailed, discardFailed, deleteSpend, restoreSpend } = useStore();
  const { open } = useQuickAdd();
  const toast = useToast();
  const online = useOnline();

  if (!ready || !summary || !cycle) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="h-44 animate-pulse rounded-3xl bg-surface" />
        <div className="h-28 animate-pulse rounded-3xl bg-surface" />
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    );
  }

  const recent = spends.filter((s) => s.spent_on >= addDays(today, -6)).slice(0, 15);
  const dayLabel = (d: string) =>
    d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : parseYmd(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const dateLabel = parseYmd(today).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  const dues = billsDueSoon(cards, today);
  const fundsDue = sinkingDueSoon(goals, today);
  const salaryDue = salaryPromptDue(cycle.starts_on, today);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">{dateLabel}</p>
          <h1 className="text-lg font-semibold">Spends</h1>
        </div>
        {(!online || pending > 0) && (
          <span className="rounded-full bg-warn/20 px-3 py-1 text-xs font-medium text-warn">
            {online ? `Syncing ${pending}…` : `Offline${pending ? ` · ${pending} to sync` : ""}`}
          </span>
        )}
      </header>

      {salaryDue && (
        <Link href="/salary" className="flex items-center justify-between rounded-2xl bg-mint/30 px-4 py-3 text-sm font-semibold text-navy">
          <span>Salary day: start your new cycle</span>
          <span aria-hidden>→</span>
        </Link>
      )}

      {failed.length > 0 && (
        <div role="alert" className="rounded-2xl bg-bad/10 p-3 text-sm text-bad">
          <p>
            <b>{failed.length === 1 ? "1 change" : `${failed.length} changes`} couldn&apos;t sync:</b> {friendly(failed[0].message)}
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={retryFailed} className="h-10 flex-1 rounded-full bg-navy text-sm font-semibold text-white">
              Retry
            </button>
            <button
              onClick={() => confirm("Discard these changes? They won't be saved.") && discardFailed()}
              className="h-10 flex-1 rounded-full border border-bad/30 text-sm font-medium"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <TodayCard />

      {dues.map((d) => (
        <p key={d.nickname} role="status" className="rounded-2xl bg-warn/15 px-4 py-3 text-sm text-warn">
          <b>{d.nickname}</b> bill due {d.inDays === 0 ? "today" : `on the ${ordinal(d.day)}`}: pay in full.
        </p>
      ))}
      {fundsDue.map((f) => (
        <Link key={f.name} href="/goals" className={`block rounded-2xl px-4 py-3 text-sm ${f.short > 0 ? "bg-warn/15 text-warn" : "bg-good/12 text-good"}`}>
          <b>{f.name}</b> due {f.inDays === 0 ? "today" : `on ${parseYmd(f.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}:{" "}
          {f.short > 0 ? `short by ${inr(f.short)}` : "fund is ready ✓"}. Log it as a Planned spend.
        </Link>
      ))}

      <OverLimits />

      <MonthCard />

      <CardStrip />

      <section>
        <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
          Recent
          <Link href="/history" className="text-xs font-medium text-navy">
            All transactions ›
          </Link>
        </h2>
        {recent.length > 0 && <p className="-mt-1 mb-2 text-xs text-muted">Tap to edit or mark refunded · swipe left to delete</p>}
        {recent.length === 0 ? (
          <p className="rounded-2xl bg-surface p-5 text-center text-sm text-muted">Nothing logged this week. Tap + to add a spend.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((s) => {
              const cat = categories.find((c) => c.id === s.category_id);
              const card = cards.find((c) => c.id === s.card_id);
              return (
                <SpendRow
                  key={s.id}
                  icon={cat?.icon ?? "•"}
                  title={cat?.name ?? (s.amount < 0 ? "Money back" : "Other")}
                  badge={
                    s.spend_type === "planned"
                      ? `Planned · ${goals.find((g) => g.id === s.goal_id)?.name ?? "fund"}`
                      : s.spend_type === "unplanned"
                        ? "Unplanned · buffer"
                        : undefined
                  }
                  subtitle={[dayLabel(s.spent_on), card?.nickname, s.note].filter(Boolean).join(" · ")}
                  amount={s.amount}
                  onTap={() => open(s)}
                  onDelete={() => {
                    const gone = deleteSpend(s.id);
                    toast({
                      msg: `Deleted ${inr(Math.abs(s.amount))}${s.amount < 0 ? " refund" : ""}`,
                      action: gone ? { label: "Undo", run: () => restoreSpend(gone) } : undefined,
                    });
                  }}
                />
              );
            })}
          </ul>
        )}
      </section>

      {error && <p className="text-xs text-bad">Sync issue: {error}</p>}
    </div>
  );
}
