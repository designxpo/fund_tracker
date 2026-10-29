import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetTotals, capUsage, moneyValue } from "./budget-controls.ts";

test("monthly allowance uses actual calendar length and highlights unaffordable plans", () => {
  const items = [{ id: "one", name: "Commitments", kind: "fixed", goal_id: null, planned: 48067, actual: 1, done: true }];
  assert.equal(budgetTotals(62000, 500, 30, items).remaining, -1067);
  assert.equal(budgetTotals(62000, 460, 30, items).remaining, 133);
  assert.equal(budgetTotals(62000, 460, 31, items).remaining, -327);
  assert.equal(budgetTotals(62000, 500, 30, items).affordableDaily, 464);
});

test("money validation rejects negatives, malformed decimals and non-finite input", () => {
  for (const value of ["", "-1", "1.2.3", "Infinity", "NaN", "1e3", "12.345", "100000001"]) assert.throws(() => moneyValue(value));
  assert.equal(moneyValue("0"), 0);
  assert.equal(moneyValue("7500.50"), 7500.5);
});

test("refunds restore cap allowance; zero cap is a spending stop", () => {
  assert.deepEqual(capUsage(1000, 1200 - 300), { remaining: 100, percent: 90 });
  assert.deepEqual(capUsage(0, 100), { remaining: -100, percent: 100 });
  assert.deepEqual(capUsage(1000, -50), { remaining: 1050, percent: 0 });
});
