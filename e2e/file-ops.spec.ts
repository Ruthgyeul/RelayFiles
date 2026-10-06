import { expect, test } from "@playwright/test";
import { itemMenu, names, newFolder, openFiles } from "./helpers";

test("renames with the design's conflict message", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Alpha");
  await newFolder(page, "Beta");
  await itemMenu(page, "Alpha", "Rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await dialog.getByRole("textbox").fill("Beta");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog.getByText('Server rejected: "Beta" already exists here. Suggested: Beta (2)')).toBeVisible();
  await dialog.getByRole("textbox").fill("Gamma");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("Renamed")).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["Beta", "Gamma"]);
});

test("moves, copies and deletes through the dialogs", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Inbox");
  await newFolder(page, "Archive");

  await itemMenu(page, "Inbox", "Move");
  let dialog = page.getByRole("dialog", { name: 'Move "Inbox"' });
  await expect(dialog.getByRole("option", { name: /Inbox/ })).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.getByRole("option", { name: /root/ })).toContainText("current");
  await dialog.getByRole("option", { name: /Archive/ }).click();
  await expect(dialog.getByText("Move to Archive")).toBeVisible();
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(page.getByText("Moved 1 item to Archive")).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["Archive"]);

  await itemMenu(page, "Archive", "Copy");
  dialog = page.getByRole("dialog", { name: 'Copy "Archive"' });
  await dialog.getByRole("option", { name: /root/ }).click();
  await dialog.getByRole("button", { name: "Copy here" }).click();
  await expect(page.getByText("Copied 1 item to root · renamed 1 to avoid duplicates")).toBeVisible();
  await expect(page.locator('[data-item="Archive (2)"]')).toContainText("1 item");

  await page.getByRole("checkbox", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete 2 items?" });
  await expect(confirm.getByText("0 files · 0 B will be permanently deleted. Share links to them stop working. This can't be undone.")).toBeVisible();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("2 items deleted")).toBeVisible();
  await expect(page.getByText("This folder is empty")).toBeVisible();
});

test("tags items and finds them by tag", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Trip");
  await itemMenu(page, "Trip", "Tags");
  const dialog = page.getByRole("dialog", { name: "Tags · Trip" });
  await dialog.getByRole("textbox", { name: "Add a tag" }).fill("Road Trip");
  await dialog.getByRole("textbox", { name: "Add a tag" }).press("Enter");
  await expect(dialog.getByText("road-trip")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.locator('[data-item="Trip"]').getByText("road-trip").click();
  await expect(page.getByText("across all folders")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search in this folder" })).toHaveValue("#road-trip");
  await expect.poll(() => names(page)).toEqual(["Trip"]);
});

test("share settings, new link and activity", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Public stuff");
  await itemMenu(page, "Public stuff", "Sharing & access");
  const dialog = page.getByRole("dialog", { name: "Folder settings · Public stuff" });
  await expect(dialog.getByText("Only the admin can set deletion schedules.")).toBeVisible();
  await dialog.getByRole("button", { name: /Public\s*Anyone with the link/ }).click();
  await dialog.getByRole("button", { name: "Stream only" }).click();
  await dialog.getByLabel("Max downloads").fill("5x");
  await expect(dialog.getByLabel("Max downloads")).toHaveValue("5");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  const row = page.locator('[data-item="Public stuff"]');
  await expect(row.getByText("Public", { exact: true })).toBeVisible();
  await expect(row.getByText("Stream only")).toBeVisible();
  await expect(row.getByText("0 / 5 downloads")).toBeVisible();

  await itemMenu(page, "Public stuff", "New link");
  await page.getByRole("dialog", { name: 'Create a new link for "Public stuff"?' }).getByRole("button", { name: "New link" }).click();
  await expect(page.getByText("New link created · old link disabled")).toBeVisible();
  await itemMenu(page, "Public stuff", "Link activity");
  const log = page.getByRole("dialog", { name: "Link activity · Public stuff" });
  await expect(log.getByText("Link regenerated")).toBeVisible();
  await expect(log.getByText("Previous link disabled")).toBeVisible();
});

test("drags items onto a folder to move them", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1024, "Drag and drop is a desktop gesture; touch uses Move.");
  await openFiles(page);
  await newFolder(page, "Target");
  await newFolder(page, "Loose");
  await page.locator('[data-item="Loose"]').dragTo(page.locator('[data-item="Target"]'));
  await expect(page.getByText("Moved 1 item to Target")).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["Target"]);
});
