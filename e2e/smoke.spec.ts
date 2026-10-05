import { expect, test } from "@playwright/test";

test("login page offers password sign-in", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Spends" })).toBeVisible();
  const configured = await page.getByPlaceholder("Password").count();
  if (configured) {
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Forgot password?" })).toBeVisible();
  } else {
    await expect(page.getByText("Supabase isn't configured")).toBeVisible();
  }
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("installable: manifest and icons", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Spends");
  expect(manifest.display).toBe("standalone");
  const icon = await request.get("/icons/192");
  expect(icon.headers()["content-type"]).toContain("image/png");
});
