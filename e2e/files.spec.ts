import { expect, test, type Page } from "@playwright/test";

/** Opens the File Manager as a fresh visitor (an anonymous account is created first). */
async function openFiles(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.goto("/files");
  await expect(page.getByRole("heading", { level: 1, name: "root" })).toBeVisible();
}

async function newFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New folder" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(`[data-item="${name}"]`)).toBeVisible();
}

test("an empty root shows the design's empty state", async ({ page }) => {
  await openFiles(page);
  await expect(page.getByText("This folder is empty")).toBeVisible();
  await expect(page.getByText("root folder")).toBeVisible();
  await expect(page.getByText("Private", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy path" })).toHaveText("/");
});

test("creates folders, renames duplicates and navigates with crumbs", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Videos");
  await page.getByRole("button", { name: "New folder" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByRole("textbox").fill("Videos");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText('"Videos" already exists · created "Videos (2)"')).toBeVisible();

  await page.locator('[data-item="Videos"]').getByText("Videos", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Videos" })).toBeVisible();
  await expect(page).toHaveURL(/\/files\/[a-z0-9]{12}$/);
  await expect(page.getByText("Private · inherited")).toBeVisible();
  await newFolder(page, "2024");
  await expect(page.getByRole("button", { name: "Copy path" })).toHaveText("/Videos");

  await page.getByRole("navigation", { name: "Path" }).getByRole("link", { name: "root" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "root" })).toBeVisible();
  const videos = page.locator('[data-item="Videos"]');
  await expect(videos).toContainText("1 item");
});

test("filters, searches, sorts and switches to the grid", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "b-folder");
  await newFolder(page, "a-folder");
  await expect(page.getByRole("group", { name: "Filter by type" }).getByRole("button", { name: /Folders\s*2/ })).toBeVisible();

  const names = () => page.locator("[data-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-item")));
  expect(await names()).toEqual(["a-folder", "b-folder"]);
  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("menuitem", { name: "Name Z → A" }).click();
  expect(await names()).toEqual(["b-folder", "a-folder"]);

  await page.locator("body").press("/");
  await page.getByRole("textbox", { name: "Search in this folder" }).fill("a-f");
  expect(await names()).toEqual(["a-folder"]);
  await page.getByRole("textbox", { name: "Search in this folder" }).fill("zzz");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.getByRole("textbox", { name: "Search in this folder" }).fill("#");
  await expect(page.getByText("Type a tag after #").first()).toBeVisible();

  await page.getByRole("button", { name: "Search in this folder" }).click();
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.getByRole("button", { name: "List view" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "List view" })).toBeVisible();
});

test("selection, menu and properties", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Docs");
  await page.getByRole("checkbox", { name: "Select Docs" }).click();
  await expect(page.getByRole("toolbar", { name: "Files" })).toContainText("1");
  await page.getByRole("checkbox", { name: "Select all" }).click();

  await page.getByRole("button", { name: "Actions for Docs" }).click();
  await page.getByRole("menuitem", { name: "Properties" }).click();
  const dialog = page.getByRole("dialog", { name: "Properties of Docs" });
  await expect(dialog.getByText("Top level of this account")).toBeHidden();
  await expect(dialog.getByText("0 files, 0 folders")).toBeVisible();
  await expect(dialog.getByText("Deleted with account")).toBeVisible();
  await expect(dialog.getByText(/\/d\/[a-z0-9]{10}$/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Folder menu" }).click();
  await page.getByRole("menuitem", { name: "Direct link" }).click();
  await expect(page.getByText("Link copied · private, only you can open it")).toBeVisible();
});

test("other accounts' folders are not found", async ({ page, browser }) => {
  await openFiles(page);
  await newFolder(page, "Secret");
  await page.locator('[data-item="Secret"]').getByText("Secret", { exact: true }).click();
  await expect(page).toHaveURL(/\/files\/[a-z0-9]{12}$/);
  const url = page.url();

  const other = await browser.newContext();
  const intruder = await other.newPage();
  await openFiles(intruder);
  // The page streams behind the loading skeleton, so the not-found screen arrives with status 200.
  await intruder.goto(url);
  await expect(intruder.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(intruder.getByText("Secret")).toBeHidden();
  await other.close();
});
