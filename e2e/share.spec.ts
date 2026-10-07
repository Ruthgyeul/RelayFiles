import { expect, test, type Browser, type Page, type ViewportSize } from "@playwright/test";
import type { FolderView, NodeItem } from "@/contracts/nodes";
import { itemMenu, newFolder, openFiles, silentWav } from "./helpers";

const rootItems = (page: Page) => page.evaluate(async () => ((await (await fetch("/api/folders/root")).json()) as { data: FolderView }).data.children);

/** Owner: a "Trip" folder with notes.txt, returning its node and link. */
async function tripWithFile(page: Page): Promise<NodeItem> {
  await openFiles(page);
  await newFolder(page, "Trip");
  await page.locator('[data-item="Trip"]').getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Trip" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("see you there") }]);
  await expect(page.locator('[data-item="notes.txt"]')).toBeVisible();
  return (await rootItems(page)).find((item) => item.name === "Trip")!;
}

/** A separate visitor (own cookies, no account) with the project's address and viewport. */
async function visitorPage(browser: Browser, baseURL: string | undefined, viewport: ViewportSize | null): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport });
  return context.newPage();
}

/** Saves share settings through the API (what the settings dialog sends). */
async function saveSettings(page: Page, id: string, changes: Record<string, unknown>) {
  const res = await page.request.put(`/api/nodes/${id}/settings`, {
    data: { visibility: "public", expiry: "Never", burn: false, downloadLimit: null, access: "both", note: "", applyDown: false, ...changes },
  });
  expect(res.status()).toBe(200);
}

test("the owner previews a private link and makes it public", async ({ page }) => {
  await tripWithFile(page);
  await page.getByRole("button", { name: "Folder menu" }).click();
  await page.getByRole("menuitem", { name: "Share", exact: true }).click();

  await expect(page.getByText(/^Visitor preview · .*\/d\/[a-z0-9]{10}$/)).toBeVisible();
  const card = page.getByRole("region", { name: "This link is private" });
  await expect(card.getByText("Only the owner can open it. Ask them to make it public.")).toBeVisible();
  await expect(card.getByText("You're previewing as a visitor.")).toBeVisible();
  await card.getByRole("button", { name: "Make public" }).click();
  await expect(page.getByText("Now public")).toBeVisible();
  await expect(page.locator('[data-item="notes.txt"]')).toContainText("13 B · File");
  await expect(page.getByText("Shared privately with RelayFiles")).toBeVisible();

  await page.getByRole("link", { name: "Back to app" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Trip" })).toBeVisible();
});

test("visitors browse, download and view, and see the file manager's Share page", async ({ page, browser, baseURL, viewport }) => {
  const trip = await tripWithFile(page);
  await saveSettings(page, trip.id, { note: "Bring sunscreen" });
  await page.getByRole("button", { name: "Share page" }).click();
  await expect(page.getByText("Bring sunscreen")).toBeVisible();

  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto(`/d/${trip.linkId}`);
  await expect(visitor.getByText(/^Visitor preview/)).toHaveCount(0);
  await expect(visitor.getByRole("region", { name: "Trip" }).getByText("1 item")).toBeVisible();
  const download = visitor.waitForEvent("download");
  await visitor.locator('[data-item="notes.txt"]').getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("notes.txt");

  await visitor.getByRole("button", { name: "Copy link" }).click();
  await expect(visitor.getByText("Link copied")).toBeVisible();
  await visitor.locator('[data-item="notes.txt"]').getByText("notes.txt").click();
  await expect(visitor.getByRole("dialog", { name: "notes.txt" }).getByText("No preview for this file type")).toBeVisible();
  const width = await visitor.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);
  await visitor.context().close();

  // The owner sees the download in the link activity.
  await page.goto(`/files/${trip.id}`);
  await page.getByRole("button", { name: "Folder menu" }).click();
  await page.getByRole("menuitem", { name: "Link activity" }).click();
  await expect(page.getByRole("dialog").getByText("Downloaded")).toBeVisible();
});

test("password links unlock with the right password", async ({ page, browser, baseURL, viewport }) => {
  const trip = await tripWithFile(page);
  await saveSettings(page, trip.id, { password: "open sesame" });
  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto(`/d/${trip.linkId}`);
  const card = visitor.getByRole("region", { name: "This folder is password protected" });
  await expect(card.getByText("Enter the password you were given to view Trip.")).toBeVisible();
  await card.getByRole("textbox", { name: "Password" }).fill("nope");
  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(card.getByRole("alert")).toHaveText("Wrong password");
  await card.getByRole("textbox", { name: "Password" }).fill("open sesame");
  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(visitor.locator('[data-item="notes.txt"]')).toBeVisible();
  await visitor.context().close();
});

test("unknown links show the link page, and stream-only links hide downloads", async ({ page, browser, baseURL, viewport }) => {
  const trip = await tripWithFile(page);
  await saveSettings(page, trip.id, { access: "stream" });
  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto("/d/aaaaaaaaaa");
  await expect(visitor.getByRole("heading", { name: "Link not found" })).toBeVisible();
  await visitor.goto(`/d/${trip.linkId}`);
  await expect(visitor.getByText("Downloads disabled")).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Download all" })).toHaveCount(0);
  await expect(visitor.locator('[data-item="notes.txt"]').getByRole("button", { name: "Download" })).toHaveCount(0);
  await visitor.context().close();
});

test("the file menu has no Share entry but folders do", async ({ page }) => {
  await tripWithFile(page);
  await page.getByRole("button", { name: "Actions for notes.txt" }).click();
  await expect(page.getByRole("menuitem", { name: "Share", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/files");
  await itemMenu(page, "Trip", "Share");
  await expect(page.getByRole("region", { name: "This link is private" })).toBeVisible();
});

test("share pages show image and audio previews under the file names", async ({ page, browser, baseURL, viewport }) => {
  const trip = await tripWithFile(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([
    { name: "dot.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") },
    { name: "tone.wav", mimeType: "audio/wav", buffer: silentWav() },
  ]);
  await expect(page.locator('[data-item="tone.wav"]')).toBeVisible();
  await saveSettings(page, trip.id, {});

  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto(`/d/${trip.linkId}`);
  await expect(visitor.locator('[data-item="tone.wav"] [data-preview="audio"] audio')).toBeVisible();
  await expect(visitor.locator('[data-item="notes.txt"] [data-preview]')).toHaveCount(0);
  await visitor.locator('[data-item="dot.png"] [data-preview="image"] > div').click();
  await expect(visitor.getByRole("dialog", { name: "dot.png" })).toBeVisible();
  const width = await visitor.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);
  await visitor.context().close();
});
