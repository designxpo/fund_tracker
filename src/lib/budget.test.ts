import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleEnd, summarize, capLevel, suggestCardId, diffDays, isBirthdayWindow, billsDueSoon, ordinal, salaryPromptDue } from "./budget.ts";

const cycle = { starts_on: "2026-10-01", ends_on: null, daily_budget: 500 };

test("cycle runs one month, inclusive", () => {
  assert.equal(cycleEnd("2026-10-01", null), "2026-10-31");
  assert.equal(cycleEnd("2026-01-31", null), "2026-02-27"); // clamps to Feb 28, minus a day
  assert.equal(cycleEnd("2026-10-01", "2026-10-20"), "2026-10-20");
  assert.equal(diffDays("2026-10-01", "2026-11-01"), 31);
});

test("left today = daily - today's spends", () => {
  const s = summarize([{ amount: 220, spent_on: "2026-10-03" }], cycle, "2026-10-03");
  assert.equal(s.leftToday, 280);
  assert.equal(s.todaySpent, 220);
});

test("week is a 7-day block from cycle start; overspend carries within the week", () => {
  const spends = [
    { amount: 900, spent_on: "2026-10-01" },
    { amount: 100, spent_on: "2026-10-03" },
  ];
  const s = summarize(spends, cycle, "2026-10-03");
  assert.equal(s.week.start, "2026-10-01");
  assert.equal(s.week.end, "2026-10-07");
  assert.equal(s.week.budget, 3500);
  assert.equal(s.week.left, 2500);
  assert.equal(s.week.daysLeft, 5);
  assert.equal(s.leftToday, 400);
});

test("second block starts day 8; last block is shorter", () => {
  const s = summarize([], cycle, "2026-10-09");
  assert.equal(s.week.start, "2026-10-08");
  const last = summarize([], cycle, "2026-10-30");
  assert.equal(last.week.start, "2026-10-29");
  assert.equal(last.week.end, "2026-10-31");
  assert.equal(last.week.budget, 1500);
  assert.equal(last.cycle.budget, 15500);
  assert.equal(last.cycle.daysLeft, 2);
});

test("card cap levels", () => {
  assert.equal(capLevel(3999, 5000), "ok");
  assert.equal(capLevel(4000, 5000), "amber");
  assert.equal(capLevel(5000, 5000), "red");
  assert.equal(capLevel(100, 0), "ok");
});

test("small amounts use the small-amount card", () => {
  const other = { suggested_card_id: "shopping", small_card_id: "upi" };
  assert.equal(suggestCardId(other, 150), "upi");
  assert.equal(suggestCardId(other, 200), "shopping");
  assert.equal(suggestCardId({ suggested_card_id: "rewards", small_card_id: null }, 50), "rewards");
});

test("birthday window is ±1 day and overrides suggestion", () => {
  assert.ok(isBirthdayWindow("1995-10-04", "2026-10-03"));
  assert.ok(isBirthdayWindow("1995-10-04", "2026-10-05"));
  assert.ok(!isBirthdayWindow("1995-10-04", "2026-10-06"));
  assert.ok(isBirthdayWindow("1995-01-01", "2026-12-31"));
  assert.equal(suggestCardId({ suggested_card_id: "shopping", small_card_id: null }, 500, "rewards"), "rewards");
});

test("bill reminders fire 3 days before due day", () => {
  const cards = [{ nickname: "Rewards card", due_day: 15 }, { nickname: "Shopping card", due_day: 28 }, { nickname: "X", due_day: null }];
  assert.deepEqual(billsDueSoon(cards, "2026-10-12"), [{ nickname: "Rewards card", day: 15, inDays: 3 }]);
  assert.equal(billsDueSoon(cards, "2026-10-11").length, 0);
  assert.equal(billsDueSoon(cards, "2026-10-15")[0].inDays, 0);
  assert.equal(billsDueSoon(cards, "2026-10-16").length, 0);
  assert.equal(billsDueSoon([{ nickname: "E", due_day: 2 }], "2026-10-30")[0].inDays, 3);
  assert.equal(ordinal(1) + ordinal(2) + ordinal(3) + ordinal(11) + ordinal(15) + ordinal(22), "1st2nd3rd11th15th22nd");
});

test("salary prompt only in day 1-3 of a later month", () => {
  assert.ok(salaryPromptDue("2026-10-01", "2026-11-02"));
  assert.ok(!salaryPromptDue("2026-11-01", "2026-11-02"));
  assert.ok(!salaryPromptDue("2026-10-01", "2026-11-10"));
});
