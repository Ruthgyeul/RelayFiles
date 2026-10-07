import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { FolderView } from "@/contracts/nodes";
import { openFiles, silentWav } from "./helpers";

/** 1×1 PNG, detected as an image by the server. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function uploadTwo(page: Page) {
  await openFiles(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([
    { name: "dot.png", mimeType: "image/png", buffer: PNG },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello relay") },
  ]);
  await expect(page.locator('[data-item="notes.txt"]')).toBeVisible();
  await page.getByRole("region", { name: "Transfers" }).getByRole("button", { name: "Close transfers" }).click();
}

const rootItems = (page: Page) => page.evaluate(async () => ((await (await fetch("/api/folders/root")).json()) as { data: FolderView }).data.children);

test("previews files in the viewer and steps between them", async ({ page }) => {
  await uploadTwo(page);
  await page.locator('[data-item="dot.png"]').getByRole("button", { name: "Preview" }).click();
  const viewer = page.getByRole("dialog", { name: "dot.png" });
  await expect(viewer.getByRole("img", { name: "dot.png" })).toBeVisible();
  await expect(viewer.getByText("1 / 2")).toBeVisible();

  await viewer.getByRole("button", { name: "Next file" }).click();
  const other = page.getByRole("dialog", { name: "notes.txt" });
  await expect(other.getByText("No preview for this file type")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: "dot.png" })).toBeVisible();
  await page.getByRole("button", { name: "Close viewer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("shows media previews under file names at every width", async ({ page }) => {
  await uploadTwo(page);
  await expect(page.locator('[data-item="dot.png"] [data-preview="image"] img')).toBeVisible();
  await expect(page.locator('[data-item="notes.txt"] [data-preview]')).toHaveCount(0);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([{ name: "tone.wav", mimeType: "audio/wav", buffer: silentWav() }]);
  const player = page.locator('[data-item="tone.wav"] audio');
  await expect(player).toBeVisible();
  await page.getByRole("region", { name: "Transfers" }).getByRole("button", { name: "Close transfers" }).click();
  await expect(player).toHaveAttribute("preload", "none");
  await player.click();
  await expect(page.getByRole("dialog", { name: "tone.wav" })).toHaveCount(0);

  await page.locator('[data-item="dot.png"] [data-preview="image"] img').click();
  await expect(page.getByRole("dialog", { name: "dot.png" })).toBeVisible();
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);
});

test("downloads originals and zips, recorded in the transfers panel", async ({ page }) => {
  await uploadTwo(page);
  const single = page.waitForEvent("download");
  await page.locator('[data-item="notes.txt"]').getByRole("button", { name: "Download" }).click();
  const file = await single;
  expect(file.suggestedFilename()).toBe("notes.txt");
  expect(await readFile((await file.path())!, "utf8")).toBe("hello relay");
  const panel = page.getByRole("region", { name: "Transfers" });
  await expect(panel.getByText("DOWNLOAD", { exact: true })).toBeVisible();
  await expect(panel.getByText("1 file · 11 B · saving in your browser")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select all" }).click();
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Zip" }).click();
  const zip = await saved;
  expect(await zip.failure()).toBeNull();
  // Headless Chromium reports non-ASCII names as "download", so check the header the browser gets.
  const again = await page.request.get(zip.url());
  expect(again.headers()["content-disposition"]).toContain("filename*=UTF-8''root%20%C2%B7%202%20items.zip");
  await expect(panel.getByText("root · 2 items.zip")).toBeVisible();
});

test("shows a saved playback position in the row", async ({ page }) => {
  await uploadTwo(page);
  const notes = (await rootItems(page)).find((item) => item.name === "notes.txt")!;
  await page.evaluate((id) => localStorage.setItem("relay.resume", JSON.stringify({ v: 1, data: { [id]: { t: 72, d: 245 } } })), notes.id);
  await page.reload();
  await expect(page.locator('[data-item="notes.txt"]')).toContainText("1:12 / 4:05");
});
