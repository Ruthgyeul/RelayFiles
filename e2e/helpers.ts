import { expect, type Page } from "@playwright/test";

/** Opens the File Manager as a fresh visitor (an anonymous account is created first). */
export async function openFiles(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.goto("/files");
  await expect(page.getByRole("heading", { level: 1, name: "root" })).toBeVisible();
}

/** Creates a folder in the current folder through the New folder dialog. */
export async function newFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New folder" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(`[data-item="${name}"]`)).toBeVisible();
}

export async function itemMenu(page: Page, name: string, entry: string) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: entry }).click();
}

export const names = (page: Page) => page.locator("[data-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-item")));
