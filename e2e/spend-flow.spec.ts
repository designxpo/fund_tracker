import { expect, test } from "@playwright/test";

// Signs in as you and logs a ₹1 "Other" spend, checks the budget moved, then deletes it.
// Only runs when E2E_EMAIL and E2E_PASSWORD are set.
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD to run");

test("log a spend and see 'left today' update, then delete it", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").fill(email!);
  await page.getByPlaceholder("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Left today")).toBeVisible({ timeout: 15_000 });

  const leftBefore = await page.locator("section", { hasText: "Left today" }).locator("p[aria-live]").innerText();

  await page.getByRole("button", { name: "Add spend" }).click();
  await page.getByRole("dialog").locator("input[inputmode=decimal]").first().fill("1");
  await page.getByRole("dialog").getByRole("button", { name: /Other/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "₹1 · Other" })).toBeVisible();

  const leftAfter = await page.locator("section", { hasText: "Left today" }).locator("p[aria-live]").innerText();
  expect(leftAfter).not.toBe(leftBefore);

  // clean up: swipe the newest ₹1 row left to delete it
  const row = page.locator("li", { hasText: "₹1" }).first();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("status").filter({ hasText: "Deleted ₹1" })).toBeVisible();
});
