import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, freeMoney, emiFor, recurringExtra, addMonths, type PlannerInputs } from "./planner.ts";

// Example persona: commitments 42,000 + ₹500/day on a 58,000 salary leaves ~₹792 free.
const lines = [
  { name: "Loan EMI", kind: "loan", planned: 12000, goal_id: null },
  { name: "Phone EMI", kind: "loan", planned: 5000, goal_id: null },
  { name: "Fixed", kind: "fixed", planned: 5000, goal_id: null },
  { name: "Savings", kind: "savings", planned: 20000, goal_id: "emergency" },
  { name: "Loan prepayment", kind: "prepayment", planned: 0, goal_id: null },
  { name: "Card bills (last cycle)", kind: "bills", planned: 15000, goal_id: null },
];
const base: PlannerInputs = {
  start: "2026-11",
  cycleStart: "2026-10-01",
  salary: 58000,
  dailyBudget: 500,
  extraMonthly: 0,
  lines,
  templates: [
    {
      month: "2026-12",
      lines: lines.map((l) => ({ ...l, planned: l.name === "Phone EMI" ? 0 : l.name === "Loan prepayment" ? 4000 : l.planned })),
    },
  ],
  loanFreeFrom: "2028-06",
  loanLines: ["Loan EMI", "Loan prepayment"],
};

test("free money follows scheduled changes and loan close", () => {
  const daily = 500 * 365 / 12;
  assert.equal(Math.round(freeMoney("2026-11", base)), Math.round(58000 - daily - 42000));
  assert.equal(Math.round(freeMoney("2026-12", base)), Math.round(58000 - daily - 41000)); // -5000 EMI +4000 prepay
  assert.equal(Math.round(freeMoney("2028-06", base)), Math.round(58000 - daily - 25000)); // loan lines gone
});

test("bills/unspent lines are not commitments", () => {
  const f = freeMoney("2026-11", { ...base, lines: lines.filter((l) => l.kind !== "bills") });
  assert.equal(f, freeMoney("2026-11", base));
});

test("goal waits for free money, then fills in priority order", () => {
  const r = simulate({ ...base, extraMonthly: 10000 }, [
    { id: "phone", remaining: 30000, priority: 1, target_date: null },
    { id: "bike", remaining: 20000, priority: 2, target_date: null },
  ]);
  // ~₹10,792/mo free in Nov (10,000 extra + 792 slack), ~₹11,792 from Dec
  assert.equal(r.phone.readyBy, "2027-01");
  assert.equal(r.bike.readyBy, "2027-03"); // gets ₹4,375 leftover in Jan, then ₹11,792/mo
});

test("committed plan line funds its own goal", () => {
  const phone = { name: "Phone", kind: "savings", planned: 5000, goal_id: "phone" };
  const r = simulate(
    {
      ...base,
      lines: [...lines, phone],
      templates: base.templates.map((t) => ({ ...t, lines: [...t.lines, phone] })),
      salary: 62500,
    },
    [{ id: "phone", remaining: 15000, priority: 1, target_date: "2027-01-15" }],
  );
  assert.equal(r.phone.readyBy, "2027-01");
  assert.equal(r.phone.needPerMonth, 5000);
});

test("unreachable goal returns null", () => {
  const r = simulate({ ...base, salary: 40000, loanFreeFrom: null }, [{ id: "car", remaining: 500000, priority: 1, target_date: null }]);
  assert.equal(r.car.readyBy, null);
});

test("already-funded goal is ready immediately", () => {
  assert.equal(simulate(base, [{ id: "x", remaining: 0, priority: 1, target_date: null }]).x.readyBy, addMonths("2026-11", -1));
});

test("EMI formula", () => {
  const { emi, interest } = emiFor(100000, 0.12, 12);
  assert.equal(Math.round(emi), 8885);
  assert.equal(Math.round(interest), 6619);
});

test("recurring extra income uses latest per source within 2 months", () => {
  const inc = [
    { amount: 8000, source: "Freelance", received_on: "2026-08-05", recurring: true },
    { amount: 9000, source: "freelance", received_on: "2026-09-05", recurring: true },
    { amount: 3000, source: "Tuition", received_on: "2026-06-01", recurring: true },
    { amount: 20000, source: "Bonus", received_on: "2026-09-20", recurring: false },
  ];
  assert.equal(recurringExtra(inc, "2026-10-03"), 9000);
});

test("templates only apply after the current cycle's month", () => {
  // a template for the current month itself must not override the live plan
  const inp = { ...base, templates: [{ month: "2026-10", lines: [] }, ...base.templates] };
  assert.equal(Math.round(freeMoney("2026-11", inp)), Math.round(freeMoney("2026-11", base)));
});
