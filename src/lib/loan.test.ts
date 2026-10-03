import { test } from "node:test";
import assert from "node:assert/strict";
import { project, addMonthsISO } from "./loan.ts";

test("matches closed-form EMI schedule", () => {
  // P=300000 @ 18% with EMI 12000: simulate month by month and compare to the formula
  const P = 300000, rate = 0.18, emi = 12000, extra = 3000;
  const p = project(P, rate, emi, extra);
  let bal = P, interest = 0, n = 0;
  while (bal > 0.005 && n < 1000) {
    const i = bal * (rate / 12);
    interest += i;
    bal = bal + i - (emi + extra);
    n++;
  }
  assert.ok(Math.abs(Math.ceil(p.months) - n) <= 1);
  assert.ok(Math.abs(p.interest - interest) < Math.max(1, (emi + extra))); // final partial EMI
});

test("extra payment shortens tenure and saves interest", () => {
  const base = project(400000, 0.16, 12000, 0);
  const more = project(400000, 0.16, 12000, 5000);
  assert.ok(more.months < base.months && more.interest < base.interest);
});

test("EMI below monthly interest never closes", () => {
  assert.equal(project(1_000_000, 0.18, 10000).feasible, false);
});

test("addMonthsISO rounds up to whole months", () => {
  assert.equal(addMonthsISO("2026-10-03", 9.2), "2027-08-03");
});
