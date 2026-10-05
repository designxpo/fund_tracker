import { test } from "node:test";
import assert from "node:assert/strict";
import { monthSummary, salaryUtilisation, type MonthItem } from "./month.ts";

// Example persona's checklist (amounts are what was entered on Salary Day).
const items: MonthItem[] = [
  { name: "Loan EMI", kind: "loan", planned: 12000, actual: 12000, goal_id: null },
  { name: "Phone EMI", kind: "loan", planned: 5000, actual: 5000, goal_id: null },
  { name: "Gym", kind: "fixed", planned: 1000, actual: null, goal_id: null },
  { name: "Travel pass", kind: "fixed", planned: 1000, actual: null, goal_id: null },
  { name: "Subscriptions", kind: "fixed", planned: 1000, actual: 2000, goal_id: null },
  { name: "Supplements", kind: "fixed", planned: 6000, actual: 0, goal_id: null },
  { name: "Surprise buffer", kind: "buffer", planned: 2000, actual: 2000, goal_id: "buf" },
  { name: "Emergency fund", kind: "savings", planned: 7000, actual: 7000, goal_id: "em" },
  { name: "Trip fund", kind: "savings", planned: 0, actual: 0, goal_id: "trip" },
  { name: "Mutual fund SIP", kind: "savings", planned: 4000, actual: 4000, goal_id: "lt" },
  { name: "Gold", kind: "savings", planned: 1500, actual: 2500, goal_id: "lt" },
  { name: "Loan prepayment", kind: "prepayment", planned: 0, actual: null, goal_id: null },
  { name: "Card bills (last cycle)", kind: "bills", planned: 9999, actual: null, goal_id: null },
];

test("month summary: plan vs actual and what's left", () => {
  const m = monthSummary(55000, 15500, items);
  assert.equal(m.plannedTotal, 40500);
  assert.equal(m.actualTotal, 36500);
  assert.equal(m.result, 3000); // 55,000 − 36,500 − 15,500
  assert.deepEqual(m.variances, [
    { name: "Supplements", diff: -6000 },
    { name: "Subscriptions", diff: 1000 },
    { name: "Gold", diff: 1000 },
  ]);
});

test("moving the leftover to a goal balances the month", () => {
  const m = monthSummary(55000, 15500, [...items, { name: "Leftover → Trip fund", kind: "adjustment", planned: 3000, actual: 3000, goal_id: "trip" }]);
  assert.equal(m.result, 0);
});

test("a shortfall is negative and borrowing covers it", () => {
  const over = items.map((i) => (i.name === "Supplements" ? { ...i, actual: 9000 } : i));
  assert.equal(monthSummary(55000, 15500, over).result, -6000);
  const covered = [...over, { name: "Borrowed from Trip fund", kind: "adjustment", planned: -6000, actual: -6000, goal_id: "trip" }];
  assert.equal(monthSummary(55000, 15500, covered).result, 0);
});

test("salary utilisation across buckets", () => {
  const u = salaryUtilisation(55000, 15500, 1041, items);
  const by = Object.fromEntries(u.rows.map((r) => [r.key, r.amount]));
  assert.equal(by.emis, 17000);
  assert.equal(by.fixed, 4000);
  assert.equal(by.saved, 15500);
  assert.equal(by.daily, 1041);
  assert.equal(by.dailyLeft, 14459);
  assert.equal(u.left, 55000 - (17000 + 4000 + 15500 + 15500));
});
