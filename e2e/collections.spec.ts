import type { Browser, Page, ViewportSize } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newFolder, openFiles } from "./helpers";

/** A separate visitor (own cookies, no account) with the project's address and viewport. */
async function visitorPage(browser: Browser, baseURL: string | undefined, viewport: ViewportSize | null): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport });
  return context.newPage();
}

test("shares a selection as one collection link and manages it in Shared by me", async ({ page, browser, baseURL, viewport }) => {
  await openFiles(page);
  await newFolder(page, "Trip");
  await newFolder(page, "Notes");
  await newFolder(page, "Private stuff");

  await page.getByRole("checkbox", { name: "Select Trip" }).click();
  await page.getByRole("checkbox", { name: "Select Notes" }).click();
  // The selection toolbar, one button longer, still fits the narrowest screen.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: size.height });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.setViewportSize(size);
  await page.getByRole("button", { name: /^(Collection|Share as one link)$/ }).click();
  const dialog = page.getByRole("dialog", { name: /Share as collection/ });
  await expect(dialog.getByRole("textbox").first()).toHaveValue(/ \+ 1 more$/);
  await dialog.getByRole("textbox").first().fill("Weekend");
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Link copied|^Copy failed/)).toBeVisible();

  await page.getByRole("link", { name: "Shared by me" }).click();
  const collections = page.getByRole("list", { name: "Collections list" }).getByRole("listitem");
  await expect(collections).toHaveCount(1);
  await expect(collections.first()).toContainText("Weekend");
  await expect(collections.first()).toContainText("2 items");

  // A visitor sees both folders, private as they are, and nothing else.
  const href = await collections.first().getByRole("link", { name: "Open the share page of Weekend" }).getAttribute("href");
  const visitor = await visitorPage(browser, baseURL, viewport);
  await visitor.goto(href!);
  await expect(visitor.getByRole("region", { name: "Weekend" }).getByText("2 items")).toBeVisible();
  await expect(visitor.getByRole("link", { name: /^Trip/ })).toBeVisible();
  await expect(visitor.getByRole("link", { name: /^Notes/ })).toBeVisible();
  await expect(visitor.getByText("Private stuff")).toHaveCount(0);

  // Settings: a password locks it for the visitor.
  await collections.first().getByRole("button", { name: "Settings of Weekend" }).click();
  const settings = page.getByRole("dialog", { name: /Collection settings/ });
  await settings.getByLabel("Password").fill("open sesame");
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(collections.first()).toContainText("Password");
  await visitor.reload();
  await expect(visitor.getByPlaceholder("Password")).toBeVisible();
  await expect(visitor.getByRole("link", { name: /^Trip/ })).toHaveCount(0);

  await collections.first().getByRole("button", { name: "Delete the link Weekend" }).click();
  await page.getByRole("dialog", { name: 'Delete the link "Weekend"?' }).getByRole("button", { name: "Delete link" }).click();
  await expect(page.getByText("Collection link deleted")).toBeVisible();
  await expect(page.getByRole("list", { name: "Collections list" })).toHaveCount(0);
  await visitor.context().close();
});
