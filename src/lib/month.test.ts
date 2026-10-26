import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryChange, moneyLeft, overLimits, monthSpending, monthSummary, pacePlans, planVsActual, salaryUtilisation, type MonthItem } from "./month.ts";

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
  const m = monthSummary(55000, 15500, items, [{ kind: "leftover", amount: 3000, goal_id: "trip" }]);
  assert.equal(m.result, 0);
});

test("a shortfall is negative and borrowing covers it", () => {
  const over = items.map((i) => (i.name === "Supplements" ? { ...i, actual: 9000 } : i));
  assert.equal(monthSummary(55000, 15500, over).result, -6000);
  assert.equal(monthSummary(55000, 15500, over, [{ kind: "borrow", amount: -6000, goal_id: "trip" }]).result, 0);
  // card bills / daily result settlements don't change this month's balance
  assert.equal(monthSummary(55000, 15500, over, [{ kind: "card_bills", amount: 9999, goal_id: null }]).result, -6000);
});

test("salary utilisation across buckets", () => {
  const u = salaryUtilisation(55000, 15500, 1041, items);
  const by = Object.fromEntries(u.rows.map((r) => [r.key, r.amount]));
  assert.equal(by.emis, 17000);
  assert.equal(by.fixed, 4000);
  assert.equal(by.saved, 13500);
  assert.equal(by.setAside, 2000); // Surprise buffer
  assert.equal(by.daily, 1041);
  assert.equal(by.dailyLeft, 14459);
  assert.equal(u.left, 55000 - (17000 + 4000 + 15500 + 15500));
  assert.equal(u.spent, 17000 + 4000 + 1041);
});

test("sinking-fund lines are set aside, not saved", () => {
  const withSinking = [...items, { name: "Insurance", kind: "savings", planned: 3000, actual: null, goal_id: "ins" }];
  const goals = [{ id: "ins", kind: "sinking" }, { id: "em", kind: "savings" }];
  const u = salaryUtilisation(55000, 15500, 0, withSinking, [{ kind: "leftover", amount: 1000, goal_id: "ins" }], goals);
  assert.equal(u.setAside, 2000 + 3000 + 1000);
  assert.equal(u.saved, 13500);
});

test("plan vs actual: over/under per bucket and daily pace", () => {
  const rows = planVsActual(items, [{ kind: "leftover", amount: 3000, goal_id: "lt" }], [], { budgetToDate: 5000, spent: 6200 });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual([by.fixed.plan, by.fixed.actual], [9000, 4000]); // supplements skipped, subscriptions up
  assert.deepEqual([by.saved.plan, by.saved.actual], [12500, 16500]); // gold +1000, leftover +3000
  assert.equal(by.saved.moreIsBetter, true);
  assert.deepEqual([by.daily.plan, by.daily.actual, by.daily.moreIsBetter], [5000, 6200, false]);
  // a bucket with nothing planned or spent is left out
  assert.equal(planVsActual([], [], [], { budgetToDate: 0, spent: 0 }).length, 0);
});

test("leftover sent to the loan counts as EMIs & loan", () => {
  const u = salaryUtilisation(55000, 15500, 0, items, [{ kind: "leftover", amount: 3000, goal_id: null }]);
  assert.equal(u.rows.find((r) => r.key === "emis")!.amount, 20000);
  assert.equal(u.left, 0);
});

test("money left: salary minus bills, savings, funds, spending and fund overspend", () => {
  const funds = [
    { id: "buf", kind: "buffer", name: "Surprise buffer", available: -1500 },
    { id: "em", kind: "savings", name: "Emergency fund", available: 40000 },
    { id: "cash", kind: "savings", name: "Cash at home", available: -10, locked: true },
  ];
  const m = moneyLeft(55000, items, [], funds, 6000);
  const by = Object.fromEntries(m.rows.map((r) => [r.key, r.amount]));
  assert.equal(by.bills, 17000 + 4000);
  assert.equal(by.saved, 13500);
  assert.equal(by.setAside, 2000);
  assert.equal(by.spent, 6000);
  assert.equal(by.overspent, 1500); // the buffer is ₹1,500 in the red; locked funds never count
  assert.deepEqual(m.overspent, [{ name: "Surprise buffer", amount: 1500 }]);
  assert.equal(m.left, 55000 - 21000 - 13500 - 2000 - 6000 - 1500);
});

test("money left equals the unallocated leftover plus the unspent daily budget, minus fund overspend", () => {
  const reserve = 15500;
  const fromBudget = monthSummary(55000, reserve, items).result + (reserve - 6000);
  assert.equal(moneyLeft(55000, items, [], [], 6000).left, fromBudget);
});

test("pace plans split what's left over the days to salary", () => {
  const [half, quarter, all] = pacePlans(6500, 500, 7); // ₹7,000 for 7 days, ₹500 spent today
  assert.deepEqual(half, { keep: 0.5, perDay: 500, save: 3500, todayLeft: 0 });
  assert.deepEqual(quarter, { keep: 0.25, perDay: 750, save: 1750, todayLeft: 250 });
  assert.deepEqual(all, { keep: 0, perDay: 1000, save: 0, todayLeft: 500 });
  assert.deepEqual(pacePlans(-200, 300, 7), []); // nothing left: no plan
});

test("month spending by type, with money back netted out", () => {
  const s = monthSpending([
    { amount: 500, category_id: "food" },
    { amount: 300, spend_type: "daily", category_id: "food" },
    { amount: 3528, spend_type: "unplanned", category_id: "fees" },
    { amount: -3528, spend_type: "unplanned", category_id: "fees" },
    { amount: 6180, spend_type: "planned", category_id: "ins" },
    { amount: -3000, spend_type: "daily", category_id: null },
  ]);
  assert.deepEqual(s, { everyday: 800, planned: 6180, unplanned: 3528, back: 6528, total: 800 + 6180 + 3528 - 6528 });
});

test("category change against the month before", () => {
  const now = [
    { amount: 900, category_id: "food" },
    { amount: 400, category_id: "travel" },
  ];
  assert.deepEqual(categoryChange(now, [{ amount: 1200, category_id: "food" }]), [
    { id: "food", amount: 900, before: 1200 },
    { id: "travel", amount: 400, before: 0 },
  ]);
  assert.equal(categoryChange(now, null)[0].before, null);
});

test("pace plans ignore a negative 'today' (money back today adds to what's left instead)", () => {
  assert.deepEqual(pacePlans(700, -3000, 7).at(-1), { keep: 0, perDay: 100, save: 0, todayLeft: 100 });
});

test("over the limit: funds, card caps, everyday budget and bills, biggest first", () => {
  const items = overLimits({
    funds: [
      { id: "buf", name: "Surprise buffer", kind: "buffer", available: -16055 },
      { id: "ins", name: "Insurance", kind: "sinking", available: -880 },
      { id: "em", name: "Emergency fund", kind: "savings", available: 40000 },
      { id: "cash", name: "Cash", kind: "savings", available: -5, locked: true },
    ],
    fundSpent: { buf: 17555, ins: 6180 },
    cards: [
      { id: "sbi", nickname: "SBI Card", monthly_cap: 15000 },
      { id: "upi", nickname: "UPI", monthly_cap: 0 },
    ],
    cardSpent: { sbi: 18000, upi: 50000 },
    daily: { spent: 4300, budgetToDate: 4000 },
    bills: [
      { name: "Subscriptions", planned: 1000, actual: 1400 },
      { name: "Rent", planned: 5000, actual: 5000 },
    ],
  });
  assert.deepEqual(
    items.map((x) => [x.title, x.spent, x.limit, x.over]),
    [
      ["Unplanned spends", 17555, 1500, 16055],
      ["SBI Card", 18000, 15000, 3000],
      ["Insurance (planned)", 6180, 5300, 880],
      ["Subscriptions", 1400, 1000, 400],
      ["Everyday spending", 4300, 4000, 300],
    ],
  );
});

test("nothing over: no items", () => {
  assert.deepEqual(overLimits({ funds: [], fundSpent: {}, cards: [], cardSpent: {}, daily: { spent: 10, budgetToDate: 100 }, bills: [] }), []);
});
