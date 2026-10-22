"use client";

import Link from "next/link";
import { useState } from "react";
import { inr } from "@/lib/money";
import { big, futureValue, RETURN, type Nudge } from "@/lib/coach";
import { useMoney } from "@/lib/use-money";

const TONE = { warn: "bg-warn/10", win: "bg-good/10", tip: "bg-navy/[.06]" } as const;
const ICON = { warn: "⚠️", win: "🏆", tip: "💡" } as const;

/** Nudges you've marked "Got it" stay hidden for the rest of the cycle (this device only). */
function useDismissed(cycleId: string | undefined) {
  const key = `coach:dismissed:${cycleId}`;
  const [ids, setIds] = useState<string[]>(() => {
    if (typeof window === "undefined" || !cycleId) return [];
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const dismiss = (id: string) => {
    const next = [...ids, id];
    setIds(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return { hidden: new Set(ids), dismiss };
}

function NudgeCard({ n, onDismiss }: { n: Nudge; onDismiss: () => void }) {
  return (
    <li className={`rounded-2xl p-3 text-sm ${TONE[n.tone]}`}>
      <p className="flex gap-2 font-semibold">
        <span aria-hidden>{ICON[n.tone]}</span>
        <span>{n.title}</span>
      </p>
      <p className="mt-0.5 pl-6 text-muted">{n.body}</p>
      <div className="mt-2 flex justify-end gap-2 pl-6">
        <button onClick={onDismiss} className="h-9 rounded-full px-3 text-xs font-medium text-muted">
          Got it
        </button>
        {n.href && (
          <Link href={n.href} className="grid h-9 place-items-center rounded-full bg-navy px-4 text-xs font-semibold text-white">
            Do it
          </Link>
        )}
      </div>
    </li>
  );
}

/** Insights: savings rate vs a target that rises each month, what it grows into, and every nudge. */
export function SavingsCoach() {
  const m = useMoney();
  const { hidden, dismiss } = useDismissed(m?.cycleId);
  const [all, setAll] = useState(false);
  if (!m || m.salary <= 0) return null;

  const pct = (r: number) => Math.round(r * 100);
  const saved = m.flow.saved;
  const toTarget = Math.max(0, m.target * m.salary - saved);
  const scale = Math.max(m.target * 1.4, m.rate, 0.01);
  const delta = m.lastRate == null ? null : pct(m.rate) - pct(m.lastRate);
  const nudges = m.nudges.filter((n) => !hidden.has(n.id));

  return (
    <>
      <section aria-label="Savings coach" className="glass-hero rounded-3xl p-4">
        <p className="text-sm text-muted">Your savings rate this cycle</p>
        <div className="flex items-baseline gap-3">
          <p className="text-5xl font-bold tabular-nums tracking-tight text-good">{pct(m.rate)}%</p>
          {delta != null && (
            <p className={`text-sm font-medium ${delta >= 0 ? "text-good" : "text-bad"}`}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs last month
            </p>
          )}
        </div>
        <p className="text-sm text-muted">of your salary saved & invested · {inr(saved)}</p>

        <div className="relative mt-4 h-3 rounded-full bg-ink/10" role="img" aria-label={`${pct(m.rate)}% saved, target ${pct(m.target)}%`}>
          <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${Math.min(100, (m.rate / scale) * 100)}%` }} />
          <div className="absolute -top-1 bottom-[-4px] w-[2px] rounded bg-ink" style={{ left: `calc(${(m.target / scale) * 100}% - 1px)` }} />
        </div>
        <p className="mt-2 text-sm">
          {toTarget < 1 ? (
            <b className="text-good">Target {pct(m.target)}% hit 🎯 Next month aims for {pct(m.target) + 1}%.</b>
          ) : (
            <>
              <b className="tabular-nums">{inr(toTarget)}</b> more this cycle reaches your <b>{pct(m.target)}%</b> target.
            </>
          )}
        </p>
        <p className="text-xs text-muted">The target rises one point a month: small steps you won&apos;t feel, big results you will.</p>

        {saved > 0 && (
          <div className="mt-4 rounded-2xl bg-white/60 p-3">
            <p className="text-sm font-semibold">Future you, if you keep investing {inr(saved)} a month</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[5, 10, 20].map((y) => (
                <div key={y}>
                  <dd className="text-lg font-bold tabular-nums text-good">{big(futureValue(saved, y))}</dd>
                  <dt className="text-xs text-muted">in {y} years</dt>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted">
              Every extra 1% of salary ({inr(Math.round(m.salary / 100))}/month) adds {big(futureValue(m.salary / 100, 20))} in 20 years. Assumes{" "}
              {RETURN * 100}% a year; an illustration, not a promise.
            </p>
          </div>
        )}
      </section>

      {nudges.length > 0 && (
        <section aria-label="Your coach">
          <h2 className="mb-2 text-sm font-semibold">Your coach</h2>
          <ul className="space-y-2">
            {(all ? nudges : nudges.slice(0, 3)).map((n) => (
              <NudgeCard key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
            ))}
          </ul>
          {nudges.length > 3 && (
            <button onClick={() => setAll((v) => !v)} className="mt-2 h-10 w-full rounded-full text-sm font-medium text-muted">
              {all ? "Show fewer" : `Show ${nudges.length - 3} more tips`}
            </button>
          )}
        </section>
      )}
    </>
  );
}

/** Home: the savings rate and the most important nudge, every time the app opens. */
export function CoachCard() {
  const m = useMoney();
  const { hidden, dismiss } = useDismissed(m?.cycleId);
  if (!m || m.salary <= 0) return null;
  const nudges = m.nudges.filter((n) => !hidden.has(n.id));
  const top = nudges[0];
  return (
    <section aria-label="Savings coach" className="space-y-2">
      <Link href="/insights" className="flex items-center justify-between rounded-2xl bg-good/10 px-4 py-3 text-sm">
        <span>
          Saving <b className="text-good">{Math.round(m.rate * 100)}%</b> of salary · target <b>{Math.round(m.target * 100)}%</b>
        </span>
        <span className="text-xs text-muted">{nudges.length > 1 ? `${nudges.length} tips ›` : "Coach ›"}</span>
      </Link>
      {top && (
        <ul>
          <NudgeCard n={top} onDismiss={() => dismiss(top.id)} />
        </ul>
      )}
    </section>
  );
}
