import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetAlerts, spendImpact, type AlertInput } from "./alerts.ts";

const range = (budget: number, spent: number, daysLeft: number, start: string, end: string) => ({
  budget, spent, left: budget - spent, daysLeft, start, end,
});
const make = (today: number, week: number, cycle: number, d = { wkLeft: 5, cyLeft: 29 }): AlertInput => ({
  todaySpent: today,
  leftToday: 500 - today,
  week: range(3500, week, d.wkLeft, "2026-10-01", "2026-10-07"),
  cycle: range(15500, cycle, d.cyLeft, "2026-10-01", "2026-10-31"),
});

test("quiet when well under budget", () => {
  assert.deepEqual(budgetAlerts(make(100, 800, 800), 500, "2026-10-03"), []);
});

test("day warns at 80% and flags over", () => {
  assert.equal(budgetAlerts(make(400, 1000, 1000), 500, "2026-10-03")[0].text, "80% of today's budget used · ₹100 left");
  const over = budgetAlerts(make(650, 1200, 1200), 500, "2026-10-03");
  assert.equal(over[0].level, "over");
  assert.equal(over[0].text, "₹150 over today's budget");
});

test("week warning includes per-day allowance for remaining days", () => {
  const a = budgetAlerts(make(0, 2900, 2900), 500, "2026-10-03").find((x) => x.scope === "week")!;
  assert.equal(a.text, "83% of this week used · ₹600 left (₹150/day for 4 more days)");
});

test("over alerts sort before warnings", () => {
  const a = budgetAlerts(make(450, 3600, 3600), 500, "2026-10-03");
  assert.deepEqual(a.map((x) => x.scope), ["week", "day", "pace"]);
});

test("pace alert projects the cycle overshoot", () => {
  // 10 days in, ₹6,000 spent → ₹600/day → ₹18,600 projected vs ₹15,500
  const s = make(0, 1500, 6000, { wkLeft: 5, cyLeft: 22 });
  const pace = budgetAlerts(s, 500, "2026-10-10").find((x) => x.scope === "pace")!;
  assert.equal(pace.text, "At this pace you'll overshoot this cycle by ₹3,100. Keep to ₹432/day to finish on budget.");
});

test("no pace alert in the first two days", () => {
  assert.equal(budgetAlerts(make(0, 1400, 1400, { wkLeft: 6, cyLeft: 30 }), 500, "2026-10-02").find((x) => x.scope === "pace"), undefined);
});

test("spend impact preview", () => {
  const before = make(300, 3000, 3000);
  assert.deepEqual(spendImpact(before, make(450, 3150, 3150)), { level: "ok", text: "₹50 left today after this" });
  assert.deepEqual(spendImpact(before, make(800, 3500 + 100, 3500)), { level: "over", text: "Puts you ₹300 over today · ₹100 over this week" });
});
