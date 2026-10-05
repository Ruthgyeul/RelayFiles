import { expect, test } from "@playwright/test";

test("home renders with the default theme and no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "RelayFiles" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sky");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
