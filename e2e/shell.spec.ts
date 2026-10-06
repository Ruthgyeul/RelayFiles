import { expect, test, type Page } from "@playwright/test";

const isDesktop = (page: Page) => page.viewportSize()!.width >= 1024;

/** Waits for the first-visit anonymous account and returns its name. */
async function firstVisit(page: Page): Promise<string> {
  await page.goto("/");
  const banner = page.getByText(/^You're signed in as anon-[a-z2-9]{6}$/);
  await expect(banner).toBeVisible();
  return (await banner.textContent())!.replace("You're signed in as ", "");
}

async function openNavigation(page: Page) {
  if (!isDesktop(page)) await page.getByRole("button", { name: "Toggle navigation" }).click();
  return isDesktop(page) ? page.getByRole("complementary", { name: "Sidebar" }) : page.getByRole("dialog", { name: "Navigation" });
}

test("first visit creates an anonymous account and offers to save its token", async ({ page }) => {
  const name = await firstVisit(page);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sky");

  const nav = await openNavigation(page);
  await expect(nav.getByText(name, { exact: true })).toBeVisible();
  await expect(nav.getByText(/^Deletes [A-Z][a-z]{2} \d{1,2}$/)).toBeVisible();
  await expect(nav.getByText("5.0 GB", { exact: false })).toBeVisible();
  if (!isDesktop(page)) await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Save token" }).click();
  const dialog = page.getByRole("dialog", { name: "Save your account token" });
  await expect(page.getByTestId("new-token")).toHaveText(/^[A-Za-z0-9]{40}$/);
  await dialog.getByRole("checkbox").click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^You're signed in as/)).toBeHidden();
});

test("layout matches the design at each width", async ({ page }) => {
  await firstVisit(page);
  const header = page.locator("header");
  expect(await header.evaluate((el) => getComputedStyle(el).height)).toBe("60px");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const toggle = page.getByRole("button", { name: "Toggle navigation" });

  if (isDesktop(page)) {
    await expect(sidebar).toBeVisible();
    expect(await sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(240);
    await toggle.click();
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(68);
    await page.reload();
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(68);
  } else {
    await expect(sidebar).toBeHidden();
    await toggle.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    expect(await drawer.evaluate((el) => el.getBoundingClientRect().width)).toBe(260);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("footer shows live server status and opens the shortcuts", async ({ page }) => {
  await firstVisit(page);
  await expect(page.getByRole("link", { name: "All systems operational" })).toBeVisible();
  await page.locator("body").press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Shortcuts/ }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("adds a second account, switches between them and signs one out", async ({ page }) => {
  const first = await firstVisit(page);
  let nav = await openNavigation(page);
  await nav.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("dialog", { name: "Sign in" }).getByRole("button", { name: "Create anonymous account" }).click();
  const tokenDialog = page.getByRole("dialog", { name: "Save your account token" });
  await tokenDialog.getByRole("checkbox").click();
  await tokenDialog.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/^Switched to anon-/)).toBeVisible();

  nav = await openNavigation(page);
  await nav.getByRole("button", { name: first, exact: true }).click();
  await expect(page.getByText(`Switched to ${first}`)).toBeVisible();

  if (isDesktop(page)) {
    await page.getByRole("button", { name: `Account menu for ${first}` }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("complementary", { name: "Sidebar" }).getByText(first, { exact: true })).toBeHidden();
  }
});

test("signs in on another device with a saved token", async ({ page, browser }) => {
  const name = await firstVisit(page);
  const token = await page.evaluate(async () => (await (await fetch("/api/me/token")).json()).data.token as string);

  const other = await browser.newContext({ viewport: page.viewportSize()! });
  const second = await other.newPage();
  await firstVisit(second);
  const nav = await openNavigation(second);
  await nav.getByRole("button", { name: "Add account" }).click();
  const dialog = second.getByRole("dialog", { name: "Sign in" });
  await dialog.getByPlaceholder("40-character token").fill(token);
  await dialog.getByRole("button", { name: "Sign in with token" }).click();
  await expect(second.getByText(`Signed in as ${name}`)).toBeVisible();
  await other.close();
});
