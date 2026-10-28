import type { Browser, Page, ViewportSize } from "@playwright/test";
import { expect, test } from "./fixtures";
import { itemMenu, newFolder, openFiles } from "./helpers";

/** A separate visitor (own cookies, no account) with the project's address and viewport. */
async function visitorPage(browser: Browser, baseURL: string | undefined, viewport: ViewportSize | null): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport });
  return context.newPage();
}

/** Owner: creates an upload link to a new "Inbox" folder and returns its URL. */
async function inboxLink(page: Page, password = ""): Promise<string> {
  await openFiles(page);
  await newFolder(page, "Inbox");
  await itemMenu(page, "Inbox", "Upload links");
  const dialog = page.getByRole("dialog", { name: "Upload links" });
  await expect(dialog.getByText("No upload links for this folder yet.")).toBeVisible();
  await dialog.getByRole("button", { name: "New upload link" }).click();
  await dialog.getByLabel("Title shown to uploaders").fill("Trip photos");
  if (password) await dialog.getByLabel("Password (optional)").fill(password);
  await dialog.getByLabel("At most files").fill("3");
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Upload link created and copied")).toBeVisible();
  const url = (await dialog.getByText(/\/r\/[a-z0-9]{12}$/).textContent())!;
  await dialog.getByRole("button", { name: "Close" }).click();
  return new URL(url).pathname;
}

test("a visitor sends files to an upload link without seeing the folder", async ({ page, browser, baseURL, viewport }) => {
  const path = await inboxLink(page);
  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto(path);
  await expect(visitor.getByRole("heading", { level: 1, name: "Trip photos" })).toBeVisible();
  await expect(visitor.getByText("This link takes 3 more files.")).toBeVisible();
  await visitor.getByLabel("Files to upload").setInputFiles([{ name: "beach.txt", mimeType: "text/plain", buffer: Buffer.from("sand") }]);
  await expect(visitor.getByText("Sent")).toBeVisible();
  await expect(visitor.getByText("This link takes 2 more files.")).toBeVisible();
  await visitor.context().close();

  await page.locator('[data-item="Inbox"]').getByRole("button", { name: "Open" }).click();
  await expect(page.locator('[data-item="beach.txt"]')).toBeVisible();
  await page.goto("/files");
  await itemMenu(page, "Inbox", "Upload links");
  await expect(page.getByRole("dialog", { name: "Upload links" }).getByText(/^1 of 3 files · 4 B/)).toBeVisible();
});

test("a password upload link asks for the password first, and a deleted one is gone", async ({ page, browser, baseURL, viewport }) => {
  const path = await inboxLink(page, "hunter2");
  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto(path);
  await visitor.getByLabel("Password", { exact: true }).fill("wrong");
  await visitor.getByRole("button", { name: "Unlock" }).click();
  await expect(visitor.getByText("Wrong password")).toBeVisible();
  await visitor.getByLabel("Password", { exact: true }).fill("hunter2");
  await visitor.getByRole("button", { name: "Unlock" }).click();
  await expect(visitor.getByRole("heading", { level: 1, name: "Trip photos" })).toBeVisible();

  await itemMenu(page, "Inbox", "Upload links");
  await page.getByRole("dialog", { name: "Upload links" }).getByRole("button", { name: "Delete upload link" }).click();
  await expect(page.getByText("Upload link deleted")).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole("heading", { level: 1, name: "Trip photos" })).toHaveCount(0);
  await visitor.context().close();
});
