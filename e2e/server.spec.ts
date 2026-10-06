import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page, type ViewportSize } from "@playwright/test";

async function signInAsAdmin(page: Page) {
  const out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/admin-create.mts"], { encoding: "utf8" });
  const token = /^\s*token\s+(\S+)\s*$/m.exec(out)![1]!;
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  expect((await page.request.post("/api/auth/token", { data: { token } })).status()).toBe(200);
}

async function visitorFiles(browser: Browser, baseURL: string | undefined, viewport: ViewportSize | null) {
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.goto("/files");
  return page;
}

// These tests change server-wide settings: the "server-wide" project runs them alone, after
// every other spec, one after another.
test.describe.configure({ mode: "serial" });

test("publishes an announcement that members see and can dismiss", async ({ page, browser, baseURL, viewport }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/server");
  const editor = page.getByRole("region", { name: "Announcement" });
  const message = `Maintenance tonight ${Date.now()}`;
  await editor.getByRole("textbox", { name: "Announcement text" }).fill(message);
  await editor.getByRole("button", { name: "Maintenance" }).click();
  await editor.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Announcement published")).toBeVisible();
  await expect(editor.getByText(/^Live since /)).toBeVisible();

  const member = await visitorFiles(browser, baseURL, viewport);
  const banner = member.getByRole("main").getByText(message);
  await expect(banner).toBeVisible();
  await expect(member.getByRole("main").getByText(/^Maintenance · /)).toBeVisible();
  await member.getByRole("main").getByRole("status").filter({ hasText: message }).getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
  await member.context().close();

  await editor.getByRole("button", { name: "Take down" }).click();
  await expect(page.getByText("Announcement removed")).toBeVisible();
  await expect(editor.getByText("Not showing")).toBeVisible();
});

test("switches sign-up modes with invite codes and changes the theme", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/server");
  const accounts = page.getByRole("region", { name: "New accounts" });
  try {
    await accounts.getByRole("button", { name: /Invite only/ }).click();
    await expect(accounts.getByText("Invite codes")).toBeVisible();
    const generated = page.waitForResponse((res) => res.url().endsWith("/api/admin/invites") && res.request().method() === "POST");
    await accounts.getByRole("button", { name: "Generate code" }).click();
    const { data } = (await (await generated).json()) as { data: { code: string } };
    await expect(accounts.getByText(data.code, { exact: true })).toBeVisible();
    await expect(accounts.getByText(data.code, { exact: true }).locator("..")).toContainText("Unused");
    await accounts.getByRole("button", { name: `Revoke ${data.code}` }).click();
    await expect(accounts.getByText(data.code, { exact: true })).toHaveCount(0);
    await accounts.getByRole("button", { name: /^Open/ }).click();
    await expect(accounts.getByText("Invite codes")).toHaveCount(0);
  } finally {
    await page.request.put("/api/admin/settings/signup", { data: { mode: "open" } });
  }

  const themes = page.getByRole("region", { name: "Theme" });
  try {
    await themes.getByRole("button", { name: "Plum Violet" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "plum");
    await themes.getByRole("button", { name: "Slate Sky" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sky");
  } finally {
    await page.request.put("/api/admin/settings/theme", { data: { theme: "sky" } });
  }
});
