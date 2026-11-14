import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { openFiles } from "./helpers";

/** 1×1 PNG, detected as an image by the server. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("lists photos by month, opens them in the viewer and leads back to their folder", async ({ page }) => {
  await openFiles(page);
  await page.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Photos" })).toBeVisible();
  await expect(page.getByText("No photos or videos yet.")).toBeVisible();

  await page.goto("/files");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  // No date taken in it: its file date (March 2024, sent as File.lastModified) places it.
  const dir = await mkdtemp(join(tmpdir(), "relay-photos-"));
  const spring = join(dir, "spring.png");
  await writeFile(spring, PNG);
  const march = new Date("2024-03-15T12:00:00Z");
  await utimes(spring, march, march);
  const notes = join(dir, "notes.txt");
  await writeFile(notes, "not a photo");
  await (await chooser).setFiles([spring, notes]);
  await expect(page.locator('[data-item="notes.txt"]')).toBeVisible();
  await page.getByRole("region", { name: "Transfers" }).getByRole("button", { name: "Close transfers" }).click();

  await page.getByRole("link", { name: "Photos" }).click();
  const month = page.getByRole("region", { name: "March 2024" });
  await expect(month.getByText("spring.png")).toBeVisible();
  await expect(page.getByText("notes.txt")).toHaveCount(0);

  await month.getByRole("button", { name: /spring\.png/ }).click();
  const viewer = page.getByRole("dialog", { name: "spring.png" });
  await expect(viewer.getByRole("img", { name: "spring.png" })).toBeVisible();
  await page.keyboard.press("Escape");

  await month.getByRole("link", { name: "Show spring.png in its folder" }).click();
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.locator('[data-item="spring.png"]')).toBeVisible();
  // No horizontal scroll at any width.
  await page.goto("/files/photos");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
