"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useQuickAdd } from "@/components/quick-add";
import { useToast } from "@/components/toast";
import { CardStrip } from "@/components/card-strip";
import { SpendRow } from "@/components/spend-row";
import Link from "next/link";
import { billsDueSoon, ordinal, parseYmd, salaryPromptDue } from "@/lib/budget";
import { inr } from "@/lib/money";
import { budgetAlerts } from "@/lib/alerts";

const OVER = "#ff7a7e";

function Ring({ spent, budget }: { spent: number; budget: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const ratio = budget > 0 ? spent / budget : 0;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`${Math.round(ratio * 100)}% of weekly budget used`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke={ratio > 1 ? "var(--bad)" : "var(--good)"}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, ratio))}
        transform="rotate(-90 44 44)"
        style={{ transition: "stroke-dashoffset .4s ease-out" }}
      />
      <text x="44" y="49" textAnchor="middle" className="fill-ink text-[15px] font-semibold">
        {Math.round(ratio * 100)}%
      </text>
    </svg>
  );
}

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
  const { ready, summary, spends, today, cards, categories, cycle, pending, error, deleteSpend, restoreSpend } = useStore();
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

  const { leftToday, todaySpent, week, cycle: cyc } = summary;
  const daily = Number(cycle.daily_budget);
  const todays = spends.filter((s) => s.spent_on === today);
  const dateLabel = parseYmd(today).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  const dues = billsDueSoon(cards, today);
  const alerts = budgetAlerts(summary, daily, today);
  const salaryDue = salaryPromptDue(cycle.starts_on, today);
  const tone = leftToday >= 0 ? "var(--mint)" : OVER;

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
        <Link href="/salary" className="flex items-center justify-between rounded-2xl bg-mint/25 px-4 py-3 text-sm font-medium">
          <span>Salary day: start your new cycle</span>
          <span aria-hidden>→</span>
        </Link>
      )}
      {dues.map((d) => (
        <p key={d.nickname} role="status" className="rounded-2xl bg-warn/15 px-4 py-3 text-sm text-warn">
          <b>{d.nickname}</b> bill due {d.inDays === 0 ? "today" : `on the ${ordinal(d.day)}`}: pay in full.
        </p>
      ))}

      {alerts.length > 0 && (
        <ul aria-label="Budget alerts" className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.scope}
              role={a.level === "over" ? "alert" : "status"}
              className={`flex gap-2 rounded-2xl px-4 py-3 text-sm ${a.level === "over" ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn"}`}
            >
              <span aria-hidden>{a.level === "over" ? "⛔" : a.scope === "pace" ? "📈" : "⚠️"}</span>
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-3xl bg-gradient-to-br from-navy to-navy-2 p-5 text-white shadow-lg">
        <p className="text-sm text-white/70">Left today</p>
        <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight" style={{ color: tone }} aria-live="polite">
          {inr(leftToday)}
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.min(100, (todaySpent / daily) * 100)}%`, background: tone }}
          />
        </div>
        <div className="mt-3 flex justify-between text-sm text-white/75">
          <span>
            Spent {inr(todaySpent)} of {inr(daily)}
          </span>
          <span>
            Week left <b style={{ color: week.left < 0 ? OVER : "#fff" }}>{inr(week.left)}</b>
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <section className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-sm">
          <Ring spent={week.spent} budget={week.budget} />
          <div className="min-w-0">
            <p className="text-xs text-muted">This week</p>
            <p className="font-semibold tabular-nums">{inr(week.spent)}</p>
            <p className="text-[11px] text-muted">
              of {inr(week.budget)} · {week.daysLeft}d left
            </p>
          </div>
        </section>
        <section className="flex flex-col justify-center rounded-2xl bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted">This cycle</p>
          <p className="font-semibold tabular-nums">{inr(cyc.spent)}</p>
          <div className="my-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full ${cyc.spent > cyc.budget ? "bg-bad" : "bg-good"}`}
              style={{ width: `${Math.min(100, cyc.budget ? (cyc.spent / cyc.budget) * 100 : 0)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted">
            of {inr(cyc.budget)} · {cyc.daysLeft}d to salary
          </p>
        </section>
      </div>

      <CardStrip />

      <section>
        <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
          Today
          <span className="text-xs font-normal text-muted">{todays.length ? "Swipe left to delete" : ""}</span>
        </h2>
        {todays.length === 0 ? (
          <p className="rounded-2xl bg-surface p-5 text-center text-sm text-muted">Nothing logged today. Tap + to add a spend.</p>
        ) : (
          <ul className="space-y-2">
            {todays.map((s) => {
              const cat = categories.find((c) => c.id === s.category_id);
              const card = cards.find((c) => c.id === s.card_id);
              return (
                <SpendRow
                  key={s.id}
                  icon={cat?.icon ?? "•"}
                  title={cat?.name ?? "Uncategorised"}
                  subtitle={[card?.nickname, s.note].filter(Boolean).join(" · ")}
                  amount={s.amount}
                  onTap={() => open(s)}
                  onDelete={() => {
                    const gone = deleteSpend(s.id);
                    toast({
                      msg: `Deleted ${inr(s.amount)}`,
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
