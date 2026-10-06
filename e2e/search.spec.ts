import { expect, test } from "@playwright/test";
import { newFolder, openFiles } from "./helpers";

/** 1×1 PNG, detected as an image by the server. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("finds files anywhere and opens them in their folder", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Trips");
  await page.locator('[data-item="Trips"]').getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Trips" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([{ name: "beach.png", mimeType: "image/png", buffer: PNG }]);
  await expect(page.locator('[data-item="beach.png"]')).toBeVisible();
  await page.getByRole("region", { name: "Transfers" }).getByRole("button", { name: "Close transfers" }).click();

  await page.goto("/files");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search all files" });
  // Before typing: the newest files.
  await expect(dialog.getByText("Recent files · type #tag (or #tag1 #tag2) to search tags")).toBeVisible();
  await expect(dialog.getByRole("option", { name: /beach\.png/ })).toBeVisible();

  await dialog.getByRole("textbox", { name: "Search all files and folders" }).fill("BEACH");
  await expect(dialog.getByText("1 result")).toBeVisible();
  await expect(dialog.getByRole("option", { name: /beach\.png/ })).toContainText("root / Trips");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Trips" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "beach.png" })).toBeVisible();
  await expect(page).toHaveURL(/\/files\/[a-z0-9]{12}$/);
  await page.getByRole("button", { name: "Close viewer" }).click();

  await page.getByRole("button", { name: "Search all files" }).click();
  await dialog.getByRole("textbox").fill("nothing-like-this");
  await expect(dialog.getByText("No files or folders match.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("offers global search only in the File Manager", async ({ page }) => {
  await openFiles(page);
  await expect(page.getByRole("button", { name: "Search all files" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "My Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search all files" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Search all files" })).toHaveCount(0);
});
