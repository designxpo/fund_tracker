import { expect, test } from "@playwright/test";

// Browser behaviour with synthetic records only; no requests reach the real database.
test("budget saves a future month, validates amounts, and preserves paid actuals", async ({ page }) => {
  const user = { id: "e0000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "budget@example.test", app_metadata: {}, user_metadata: {} };
  const cycle = { id: "e0000000-0000-0000-0000-000000000002", starts_on: "2026-10-01", ends_on: null, salary: 62000, daily_budget: 500 };
  const item = { id: "e0000000-0000-0000-0000-000000000003", name: "Emergency fund", kind: "savings", goal_id: null, loan_id: null, planned: 8000, actual: 7500, done: true };
  const category = { id: "e0000000-0000-0000-0000-000000000004", name: "Food delivery", icon: "🛵", sort_order: 1 };
  const card = { id: "e0000000-0000-0000-0000-000000000005", nickname: "Test card", monthly_cap: 8000, active: true, sort_order: 1 };
  let months: unknown[] = [];
  let templates: unknown[] = [];
  let caps: unknown[] = [];
  let saved: Record<string, unknown> | null = null;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://*.supabase.co/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) {
      const claims = Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      await route.fulfill({ json: { access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.test`, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user } }); return;
    }
    if (url.pathname.endsWith("/user")) { await route.fulfill({ json: user }); return; }
    const table = url.pathname.split("/").at(-1);
    if (table === "save_budget") {
      saved = route.request().postDataJSON();
      const body = saved! as { p_month: string; p_daily: number; p_salary: number; p_items: typeof item[]; p_categories: { id: string; amount: number }[] };
      months = [{ month: body.p_month, daily_budget: body.p_daily, salary: body.p_salary }];
      templates = body.p_items.map(i => ({ ...i, month: body.p_month }));
      caps = body.p_categories.map(c => ({ month: body.p_month, category_id: c.id, amount: c.amount }));
      await route.fulfill({ status: 204 }); return;
    }
    const fixtures: Record<string, unknown> = { cards: [card], categories: [category], cycles: [cycle], settings: {}, goals: [], goal_balances: [], plan_items: [item], spends: [], cycle_settlements: [], plan_templates: templates, plan_months: months, category_month_caps: caps };
    await route.fulfill({ json: fixtures[table ?? ""] ?? [] });
  });
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").fill(user.email);
  await page.getByPlaceholder("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: /Budget & spending caps/ }).click();
  await expect(page.getByRole("heading", { name: "Your budget" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add spend", exact: true })).toHaveCount(0);
  await expect(page.getByText("Savings / fund · actual ₹7,500")).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await page.getByLabel("Expected salary (₹)", { exact: true }).fill("62000");
  await page.getByLabel("Daily cap (₹)", { exact: true }).fill("-5");
  await expect(page.getByRole("button", { name: "Save budget", exact: true })).toBeDisabled();
  await page.getByLabel("Daily cap (₹)", { exact: true }).fill("400");
  await page.getByLabel("Food delivery cap (₹)", { exact: true }).fill("2000");
  await page.getByText("+ Plan a one-off expense", { exact: true }).click();
  await page.getByLabel("Expense name", { exact: true }).fill("Supplement purchase");
  await page.getByLabel("Planned cost (₹)", { exact: true }).fill("7500");
  await page.getByRole("button", { name: "Add to this plan", exact: true }).click();
  await expect(page.getByRole("region", { name: "Budget summary" })).toContainText("₹12,000");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
  await page.screenshot({ path: "test-results/budget-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  expect(saved).toMatchObject({ p_month: "2026-11-01", p_salary: 62000, p_daily: 400, p_categories: [{ id: category.id, amount: 2000 }] });
  expect((saved! as { p_items: typeof item[] }).p_items[0]).toMatchObject({ actual: 7500, done: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your budget" })).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(page.getByLabel("Daily cap (₹)", { exact: true })).toHaveValue("400");
  await expect(page.getByLabel("Food delivery cap (₹)", { exact: true })).toHaveValue("2000");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "test-results/budget-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
