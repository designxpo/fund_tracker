import { test } from "node:test";
import assert from "node:assert/strict";
import { big, coachNudges, futureValue, lumpValue, savingsStreak, savingsTarget, type CoachInput } from "./coach.ts";

const base: CoachInput = {
  salary: 100000,
  saved: 20000,
  savedPlan: 20000,
  target: 0.21,
  pastRates: [],
  unallocated: 0,
  daily: { dailyBudget: 1000, budgetToDate: 10000, spent: 10000, daysLeft: 20, budget: 30000 },
  overPlan: [],
  nextCardBill: 0,
  lastCardBillSameDay: null,
  categoryUp: null,
  topCategory: null,
  lastCycle: null,
  salaryDay: false,
};
const ids = (i: Partial<CoachInput>) => coachNudges({ ...base, ...i }).map((n) => n.id);

test("future value of a monthly SIP and a lump sum", () => {
  assert.equal(Math.round(futureValue(1000, 10)), 230039); // ₹1,000/month at 12% for 10 years
  assert.equal(Math.round(lumpValue(1000, 10)), 3106);
  assert.equal(big(230039), "₹2.3 lakh");
  assert.equal(big(12500000), "₹1.3 crore");
  assert.equal(big(4500), "₹4,500");
});

test("savings target steps up one point a month, within 10–60%", () => {
  assert.equal(savingsTarget([0.18, 0.2], 0.15), 0.21);
  assert.equal(savingsTarget([], 0.15), 0.2);
  assert.equal(savingsTarget([], 0.3), 0.3);
  assert.equal(savingsTarget([0.6], 0.3), 0.6);
  assert.equal(savingsTarget([0.02], 0.3), 0.1);
});

test("streak counts months of steady or growing savings", () => {
  assert.equal(savingsStreak([0.1, 0.15, 0.15, 0.2]), 3);
  assert.equal(savingsStreak([0.2, 0.1]), 0);
  assert.equal(savingsStreak([0.2]), 0);
});

test("nothing to say when on plan", () => {
  assert.deepEqual(ids({}), []);
});

test("warnings come before tips and wins", () => {
  const n = coachNudges({
    ...base,
    salaryDay: true,
    unallocated: 3000,
    saved: 25000,
    daily: { ...base.daily, spent: 12000 },
    pastRates: [0.1, 0.12, 0.15],
  });
  assert.deepEqual(
    n.map((x) => x.id),
    ["pay-first", "no-job", "daily-over", "target-hit", "streak"],
  );
  assert.match(n[2].title, /₹2,000 over budget/);
});

test("saving less than planned, cost creep and a category spike", () => {
  const got = ids({ saved: 15000, overPlan: [{ name: "Subscriptions", diff: 500 }], categoryUp: { name: "Food", now: 6000, before: 4000 } });
  assert.deepEqual(got, ["saved-short", "cat-up-Food", "creep-Subscriptions"]);
  // small changes are ignored
  assert.deepEqual(ids({ categoryUp: { name: "Food", now: 4300, before: 4000 }, overPlan: [{ name: "Gym", diff: 50 }] }), []);
});

test("card bill for next salary: a warning only when it grows", () => {
  const rising = coachNudges({ ...base, nextCardBill: 15000, lastCardBillSameDay: 10000 })[0];
  assert.equal(rising.tone, "warn");
  const steady = coachNudges({ ...base, nextCardBill: 10000, lastCardBillSameDay: 10000 })[0];
  assert.equal(steady.tone, "tip");
});

test("suggests a lower daily budget when last month came in well under", () => {
  const n = coachNudges({ ...base, lastCycle: { dailySpent: 21000, days: 30, dailyBudget: 1000 } }).find((x) => x.id === "lower-daily");
  assert.ok(n);
  assert.match(n.title, /₹700/);
  assert.equal(ids({ lastCycle: { dailySpent: 29000, days: 30, dailyBudget: 1000 } }).includes("lower-daily"), false);
});
