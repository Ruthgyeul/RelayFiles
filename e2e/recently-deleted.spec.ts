import { expect, test } from "./fixtures";
import { itemMenu, names, newFolder, openFiles } from "./helpers";

test("deleted items wait in Recently deleted and come back with Restore", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Keep");
  await newFolder(page, "Drop");

  await itemMenu(page, "Drop", "Delete");
  const confirm = page.getByRole("dialog", { name: 'Delete "Drop"?' });
  await expect(confirm.getByText("can be restored for 24 hours", { exact: false })).toBeVisible();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted", { exact: true })).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["Keep"]);

  await page.getByRole("link", { name: "Recently deleted" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recently deleted" })).toBeVisible();
  const row = page.locator('[data-deleted="Drop"]');
  await expect(row).toContainText("root");
  await expect(row).toContainText(/Deletes in (24|23) hours/);
  await row.getByRole("button", { name: "Restore Drop" }).click();
  await expect(page.getByText("Restored to root")).toBeVisible();
  await expect(page.getByText("Nothing here")).toBeVisible();
  // No horizontal scroll at any width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("link", { name: "Back to File Manager" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "root" })).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["Drop", "Keep"]);
});

test("deletes an item forever from Recently deleted", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Old");
  await itemMenu(page, "Old", "Delete");
  await page.getByRole("dialog", { name: 'Delete "Old"?' }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => names(page)).toEqual([]);

  await page.goto("/files/deleted");
  await page.locator('[data-deleted="Old"]').getByRole("button", { name: "Delete Old forever" }).click();
  const dialog = page.getByRole("dialog", { name: 'Delete "Old" forever?' });
  await dialog.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByText("Deleted forever")).toBeVisible();
  await expect(page.getByText("Nothing here")).toBeVisible();
});
