import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { itemMenu, names, newFolder, openFiles } from "./helpers";

async function uploadText(page: Page, name: string, content: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([{ name, mimeType: "text/plain", buffer: Buffer.from(content) }]);
  await expect(page.locator(`[data-item="${name}"]`)).toBeVisible();
  // The Transfers panel would cover item menus on small screens.
  await page.getByRole("button", { name: "Close transfers" }).click();
}

test("collects favorites where they are and organizes them in folders", async ({ page }) => {
  // One walk through the whole feature: many page loads.
  test.slow();
  await openFiles(page);
  await newFolder(page, "Docs");
  await uploadText(page, "notes.txt", "remember");

  await itemMenu(page, "Docs", "Add to favorites");
  await expect(page.getByText("Added to favorites")).toBeVisible();
  await itemMenu(page, "notes.txt", "Add to favorites");
  await expect(page.locator('[data-item="notes.txt"]').getByLabel("In Favorites")).toBeVisible();

  // The root lists Favorites first; the items themselves stay in the root.
  const entry = page.locator('[data-entry="Favorites"]');
  await expect(entry).toContainText("2 items");
  await entry.click();
  await expect(page.getByRole("heading", { level: 1, name: "Favorites" })).toBeVisible();
  await expect.poll(async () => (await names(page)).sort()).toEqual(["Docs", "notes.txt"]);

  // An organizing folder exists only in Favorites.
  await page.getByRole("button", { name: "New folder" }).click();
  const create = page.getByRole("dialog", { name: "New folder in Favorites" });
  await create.getByRole("textbox").fill("Projects");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator('[data-entry="Projects"]')).toBeVisible();

  await itemMenu(page, "Docs", "Move in favorites");
  const move = page.getByRole("dialog", { name: 'Move "Docs" in Favorites' });
  await move.getByRole("button", { name: "Projects" }).click();
  await move.getByRole("button", { name: "Move here" }).click();
  await expect(page.getByText('Moved "Docs"')).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["notes.txt"]);

  // A favorite folder opens inside Favorites, not at its real place.
  await page.locator('[data-entry="Projects"]').getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.locator('[data-item="Docs"]').getByText("Docs", { exact: true }).click();
  await expect(page).toHaveURL(/\/files\/favorites\/[a-z0-9]{12}$/);
  const path = page.getByRole("navigation", { name: "Path" });
  await expect(path.getByRole("link", { name: "Favorites" })).toBeVisible();
  await expect(path.getByRole("link", { name: "Projects" })).toBeVisible();

  // Delete offers to take the item out of Favorites only.
  await path.getByRole("link", { name: "Favorites" }).click();
  await itemMenu(page, "notes.txt", "Delete");
  const remove = page.getByRole("dialog", { name: 'Delete "notes.txt"?' });
  await remove.getByRole("button", { name: "Remove from favorites" }).click();
  await expect(page.getByText("Removed from favorites")).toBeVisible();
  await expect.poll(() => names(page)).toEqual([]);

  // Deleting the organizing folder can move what it holds up a level.
  await page.getByRole("button", { name: "Actions for Projects" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const drop = page.getByRole("dialog", { name: 'Delete "Projects"?' });
  await expect(drop.getByText("Remove the 1 favorite inside from Favorites, or move them and its folders up to Favorites.")).toBeVisible();
  await drop.getByRole("button", { name: "Move them up" }).click();
  await expect.poll(() => names(page)).toEqual(["Docs"]);

  await page.goto("/files");
  await expect.poll(async () => (await names(page)).sort()).toEqual(["Docs", "notes.txt"]);
  await expect(page.locator('[data-entry="Favorites"]')).toContainText("1 item");
});
