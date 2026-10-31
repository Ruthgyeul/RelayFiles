import { expect, test } from "./fixtures";
import { FILES } from "@/config/policy";
import { openFiles } from "./helpers";

const COUNT = FILES.lazyRenderAfter + 20;

test("long folders render lazily and stay usable", async ({ page }) => {
  await openFiles(page);
  const names = Array.from({ length: COUNT }, (_, i) => `Folder ${String(i).padStart(3, "0")}`);
  for (let i = 0; i < names.length; i += 20) {
    await Promise.all(names.slice(i, i + 20).map((name) => page.request.post("/api/folders", { data: { parentId: "root", name } })));
  }
  await page.reload();
  // Scoped to <main> and polled: while the page streams in, React parks the finished rows in a
  // hidden container outside it and then moves them, so a row read once can be a detached copy.
  const rows = page.getByRole("main").locator("[data-item]");
  await expect(rows).toHaveCount(COUNT);
  await expect.poll(() => rows.first().evaluate((row) => getComputedStyle(row).contentVisibility)).toBe("auto");

  const last = page.locator(`[data-item="${names.at(-1)}"]`);
  await last.scrollIntoViewIfNeeded();
  await last.getByRole("button", { name: `Actions for ${names.at(-1)}` }).click();
  const rename = page.getByRole("menuitem", { name: "Rename" });
  await expect(rename).toBeVisible();
  // Rows rendered late don't close the popover; a real scroll does (the bottom sheet stays).
  await page.mouse.wheel(0, -400);
  if (page.viewportSize()!.width >= 720) await expect(rename).toHaveCount(0);
  else await page.keyboard.press("Escape");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
