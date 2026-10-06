import { expect, test } from "@playwright/test";

test("unknown pages return 404 with the error screen", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
});

test("explicit error screens render their presets", async ({ page }) => {
  await page.goto("/error/storage-offline");
  await expect(page.getByRole("heading", { name: "Storage offline" })).toBeVisible();
  await page.goto("/error/400");
  await expect(page.getByRole("heading", { name: "Bad request" })).toBeVisible();
});

test("unknown error codes are 404", async ({ page }) => {
  const response = await page.goto("/error/999");
  expect(response?.status()).toBe(404);
});

test("429 counts down and then enables retry", async ({ page }) => {
  await page.goto("/error/429?retry=2&from=/");
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeDisabled();
  await expect(page.getByText(/Try again in 0:0[12]\./)).toBeVisible();
  await expect(retry).toBeEnabled({ timeout: 5_000 });
});

test("429 ignores off-site return targets", async ({ page }) => {
  await page.goto("/error/429?retry=0&from=//evil.example");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("error screens have no horizontal scroll", async ({ page }) => {
  await page.goto("/this-page-does-not-exist");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("health liveness probe answers HEAD with 204", async ({ request }) => {
  const response = await request.head("/api/health");
  expect(response.status()).toBe(204);
});
