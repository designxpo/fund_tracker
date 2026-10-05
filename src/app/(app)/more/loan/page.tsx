"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import { parseYmd } from "@/lib/budget";
import { addMonthsISO, project } from "@/lib/loan";
import { inr } from "@/lib/money";

type Loan = {
  id: string;
  name: string;
  outstanding: number | null;
  annual_rate: number | null;
  emi: number;
  emis_remaining: number | null;
  prepay_charge_pct: number;
  original_end: string | null;
};
type Prepay = { id: string; amount: number; paid_on: string };

const monthYear = (iso: string) => parseYmd(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const n = (v: unknown) => (v == null ? null : Number(v));
const digits = (v: string) => v.replace(/[^\d.]/g, "");

export default function LoanPage() {
  const { today, ready } = useStore();
  const toast = useToast();
  const sb = createClient();

  const { data, reload } = useData("loan", async () => {
    const [loan, pre, items, templates] = await Promise.all([
      sb.from("loan").select("*").limit(1).then(ok),
      sb.from("loan_prepayments").select("*").order("paid_on", { ascending: false }).then(ok),
      sb.from("plan_items").select("name, planned, cycles!inner(ends_on)").eq("kind", "prepayment").is("cycles.ends_on", null).then(ok),
      sb.from("plan_templates").select("planned").eq("kind", "prepayment").then(ok),
    ]);
    const l = (loan as Record<string, unknown>[])[0];
    // Monthly prepayment: this cycle's plan, or a higher one in an upcoming month's plan.
    const planned = Math.max(
      0,
      ...(items as { planned: number }[]).map((i) => Number(i.planned)),
      ...(templates as { planned: number }[]).map((t) => Number(t.planned)),
    );
    return {
      loan: {
        id: l.id as string,
        name: String(l.name ?? "Loan"),
        outstanding: n(l.outstanding),
        annual_rate: n(l.annual_rate),
        emi: Number(l.emi),
        emis_remaining: n(l.emis_remaining),
        prepay_charge_pct: Number(l.prepay_charge_pct ?? 0),
        original_end: (l.original_end as string) ?? null,
      } as Loan,
      prepays: (pre as Prepay[]).map((p) => ({ ...p, amount: Number(p.amount) })),
      planned,
    };
  });

  const [extra, setExtra] = useState<number | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [pAmt, setPAmt] = useState("");
  const [pDate, setPDate] = useState(today);
  const [reminder, setReminder] = useState(false);

  if (!ready || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;
  const { loan, prepays, planned } = data;

  const P = loan.outstanding ?? 0;
  const r = loan.annual_rate ?? 0;
  const configured = loan.outstanding != null && loan.annual_rate != null;
  const slider = extra ?? planned;

  const base = project(P, r, loan.emi, 0);
  const plan = project(P, r, loan.emi, planned);
  const what = project(P, r, loan.emi, slider);
  const prepaid = prepays.reduce((s, p) => s + p.amount, 0);
  const savedSoFar = configured && prepaid > 0 ? project(P + prepaid, r, loan.emi, 0).interest - base.interest : 0;
  const fees = (x: number, months: number) => (isFinite(months) ? x * Math.ceil(months) * (loan.prepay_charge_pct / 100) : 0);

  const closeLabel = (p: { months: number; feasible: boolean }) => (p.feasible ? monthYear(addMonthsISO(today, p.months)) : "Never (EMI ≤ interest)");

  async function saveLoan() {
    const patch: Record<string, number | null> = {};
    const num = (k: string, scale = 1) => (edit[k] === undefined ? undefined : edit[k] === "" ? null : Number(edit[k]) / scale);
    for (const [k, scale] of [["outstanding", 1], ["annual_rate", 100], ["emi", 1], ["emis_remaining", 1], ["prepay_charge_pct", 1]] as const) {
      const v = num(k, scale);
      if (v !== undefined) patch[k] = v;
    }
    if (!Object.keys(patch).length) return;
    try {
      ok(await sb.from("loan").update(patch).eq("id", loan.id));
      setEdit({});
      toast({ msg: "Loan details saved" });
      await reload();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't save" });
    }
  }

  async function addPrepay() {
    const v = Number(pAmt);
    if (!(v > 0)) return;
    try {
      ok(await sb.from("loan_prepayments").insert({ loan_id: loan.id, amount: v, paid_on: pDate }));
      setPAmt("");
      setReminder(true);
      await reload();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't save" });
    }
  }

  const field = (key: keyof Loan, label: string, cur: number | null, scale = 1, suffix = "") => (
    <label className="text-xs text-muted">
      {label}
      <div className="mt-1 flex items-center rounded-xl border border-line bg-bg px-3 focus-within:border-mint">
        <input
          inputMode="decimal"
          value={edit[key] ?? (cur == null ? "" : String(+(cur * scale).toFixed(4)))}
          onChange={(e) => setEdit({ ...edit, [key]: digits(e.target.value) })}
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none"
        />
        <span className="text-sm">{suffix}</span>
      </div>
    </label>
  );

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Link href="/more" className="text-sm text-muted">‹ More</Link>
        <h1 className="text-2xl font-bold">{loan.name} loan</h1>
      </div>

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">From your lender&apos;s app</h2>
        <div className="grid grid-cols-2 gap-3">
          {field("outstanding", "Outstanding principal", loan.outstanding, 1, "₹")}
          {field("annual_rate", "Interest rate (p.a.)", loan.annual_rate, 100, "%")}
          {field("emi", "EMI", loan.emi, 1, "₹")}
          {field("emis_remaining", "EMIs remaining", loan.emis_remaining)}
          {field("prepay_charge_pct", "Prepayment charge", loan.prepay_charge_pct, 1, "%")}
        </div>
        <button onClick={saveLoan} disabled={!Object.keys(edit).length} className="mt-3 h-11 w-full rounded-xl bg-navy text-sm font-semibold text-white disabled:opacity-40">
          Save
        </button>
      </section>

      {!configured ? (
        <p className="rounded-2xl bg-surface p-5 text-sm text-muted">Enter your outstanding principal and interest rate to see projections.</p>
      ) : (
        <>
          <section className="glass-hero rounded-3xl p-4">
            <p className="text-sm text-muted">Outstanding</p>
            <p className="text-3xl font-bold tabular-nums text-ink">{inr(P)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Original close</dt>
                <dd className="font-semibold">{loan.original_end ? monthYear(loan.original_end) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Projected close</dt>
                <dd className="font-semibold text-good">{closeLabel(planned > 0 ? plan : base)}</dd>
              </div>
              <div>
                <dt className="text-muted">Interest saved so far (approx.)</dt>
                <dd className="font-semibold">{inr(Math.round(savedSoFar))}</dd>
              </div>
              <div>
                <dt className="text-muted">Projected saving{planned > 0 ? ` (+${inr(planned)}/mo)` : ""}</dt>
                <dd className="font-semibold">{base.feasible && plan.feasible ? inr(Math.round(base.interest - plan.interest)) : "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-sm">
            <h2 className="text-sm font-semibold">What if I pay extra each month?</h2>
            <p className="mt-2 text-3xl font-bold tabular-nums">+{inr(slider)}</p>
            <input
              type="range"
              min={0}
              max={20000}
              step={500}
              value={slider}
              onChange={(e) => setExtra(Number(e.target.value))}
              aria-label="Extra monthly payment"
              className="mt-2 h-11 w-full accent-[var(--good)]"
            />
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Close date</dt>
                <dd className="font-semibold">{closeLabel(what)}</dd>
              </div>
              <div>
                <dt className="text-muted">Time saved</dt>
                <dd className="font-semibold">{base.feasible && what.feasible ? `${Math.round(base.months - what.months)} months` : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Interest saved</dt>
                <dd className="font-semibold text-good">{base.feasible && what.feasible ? inr(Math.round(base.interest - what.interest)) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Prepayment charges</dt>
                <dd className="font-semibold">{inr(Math.round(fees(slider, what.months)))}</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Prepayments</h2>
        <div className="flex gap-2">
          <input inputMode="decimal" placeholder="Amount ₹" value={pAmt} onChange={(e) => setPAmt(digits(e.target.value))} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />
          <input type="date" value={pDate} max={today} onChange={(e) => setPDate(e.target.value)} className="h-11 w-40 rounded-xl border border-line bg-bg px-2 text-base" />
          <button onClick={addPrepay} className="h-11 rounded-xl bg-navy px-4 text-sm font-semibold text-white">Log</button>
        </div>
        {reminder && <p className="mt-3 rounded-xl bg-mint/20 p-3 text-sm font-medium">Ask {loan.name} to reduce tenure, not EMI.</p>}
        <ul className="mt-3 divide-y divide-line text-sm">
          {prepays.length === 0 && <li className="py-2 text-muted">None logged yet.</li>}
          {prepays.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>{parseYmd(p.paid_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span className="flex items-center gap-3">
                <b className="tabular-nums">{inr(p.amount)}</b>
                <button
                  aria-label="Delete prepayment"
                  onClick={async () => {
                    ok(await sb.from("loan_prepayments").delete().eq("id", p.id));
                    await reload();
                  }}
                  className="h-9 w-9 text-muted"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Update the outstanding principal above from {loan.name}&apos;s app after each prepayment.</p>
      </section>
    </div>
  );
}
