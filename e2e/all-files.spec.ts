import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newFolder, openFiles } from "./helpers";

/** Opens a folder of the current list by its name. */
async function openFolder(page: Page, name: string) {
  await page.locator(`[data-item="${name}"]`).getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function upload(page: Page, files: { name: string; body: string }[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Upload( files)?$/ }).first().click();
  await (await chooser).setFiles(files.map(({ name, body }) => ({ name, mimeType: "text/plain", buffer: Buffer.from(body) })));
  for (const { name } of files) await expect(page.locator(`[data-item="${name}"]`)).toBeVisible();
  // The transfers panel would cover rows below it.
  await page.getByRole("button", { name: "Close transfers" }).click();
}

test("lists every file of the account without folders, from the root's All Files entry", async ({ page }) => {
  await openFiles(page);
  await upload(page, [{ name: "top.txt", body: "top" }]);
  await newFolder(page, "Trip");
  await openFolder(page, "Trip");
  await upload(page, [{ name: "alpha.txt", body: "alpha alpha" }]);
  await newFolder(page, "Day1");
  await openFolder(page, "Day1");
  await upload(page, [{ name: "beta.txt", body: "beta beta beta" }]);

  await page.goto("/files");
  const entry = page.locator('[data-entry="All Files"]');
  await expect(entry).toContainText("3 files");
  await entry.click();
  await expect(page).toHaveURL(/\/files\/all$/);
  await expect(page.getByText("All Files", { exact: true }).first()).toBeVisible();

  const rows = page.locator("[data-item]");
  await expect(rows).toHaveCount(3);
  // Newest first, each with the folder it is in; no folder rows.
  await expect(page.locator('[data-item="beta.txt"]')).toContainText("Day1");
  await expect(page.locator('[data-item="Trip"]')).toHaveCount(0);
  await expect(page.locator('[data-item="Day1"]')).toHaveCount(0);

  // Search runs on the server, over every folder.
  await page.getByRole("button", { name: "Search all files" }).click();
  await page.getByRole("searchbox").or(page.getByRole("textbox", { name: "Search all files" })).first().fill("alp");
  await expect(rows).toHaveCount(1);
  await expect(page.locator('[data-item="alpha.txt"]')).toBeVisible();
  await page.getByRole("button", { name: "Search all files" }).click();
  await expect(rows).toHaveCount(3);

  // No horizontal scroll at the narrowest width.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: size.height });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.setViewportSize(size);
});
