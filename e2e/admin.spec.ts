import { execFileSync } from "node:child_process";
import type { Browser, Page, ViewportSize } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Creates an admin with the real console script and returns its token. */
function createAdmin(): string {
  const out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/admin-create.mts"], { encoding: "utf8" });
  return /^\s*token\s+(\S+)\s*$/m.exec(out)![1]!;
}

async function signInAsAdmin(page: Page) {
  const token = createAdmin();
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  const res = await page.request.post("/api/auth/token", { data: { token } });
  expect(res.status()).toBe(200);
}

/** A separate visitor gets its own anonymous member account; returns its name. */
async function newMember(browser: Browser, baseURL: string | undefined, viewport: ViewportSize | null): Promise<string> {
  const context = await browser.newContext({ baseURL, viewport });
  const visitor = await context.newPage();
  await visitor.goto("/");
  const banner = visitor.getByText(/^You're signed in as anon-/);
  await expect(banner).toBeVisible();
  const name = /anon-[a-z0-9]{6}/.exec((await banner.textContent())!)![0];
  await context.close();
  return name;
}

test("members can't open admin pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
});

test("admins manage and delete accounts", async ({ page, browser, baseURL, viewport }) => {
  const member = await newMember(browser, baseURL, viewport);
  await signInAsAdmin(page);
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("main").getByText("File contents are private to each account and are not shown here.", { exact: false })).toBeVisible();

  await page.getByRole("textbox", { name: "Search name or ID" }).fill(member);
  const row = page.locator(`[data-account="${member}"]`);
  await expect(row.getByText("ACTIVE")).toBeVisible();
  await expect(row.getByText(/ · 14d$/)).toBeVisible();

  await row.getByRole("button", { name: "Manage" }).click();
  const dialog = page.getByRole("dialog", { name: `Manage ${member}` });
  await dialog.getByRole("button", { name: "+30 days" }).click();
  await expect(dialog.getByText(/^Currently deletes .*\. After saving: .*\.$/)).toBeVisible();
  await dialog.getByRole("button", { name: "10 GB" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Account updated")).toBeVisible();
  await expect(row.getByText(/ · 44d$/)).toBeVisible();
  await expect(row.getByText("0 B / 10 GB")).toBeVisible();

  await row.getByRole("button", { name: `Delete ${member}` }).click();
  await page.getByRole("dialog", { name: `Delete ${member}?` }).getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText("Account deleted")).toBeVisible();
  await expect(page.getByText("No accounts match.")).toBeVisible();

  await page.getByRole("textbox", { name: "Search name or ID" }).fill("");
  await page.getByRole("button", { name: /^Expiring soon \d+$/ }).click();
  await expect(page.getByRole("button", { name: /^Expiring soon \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Run cleanup now" }).click();
  await expect(page.getByText(/^(Nothing to clean up|\d+ account\(s\).*deleted)$/)).toBeVisible();
});

test("lists admin actions in the audit log and filters them", async ({ page }) => {
  await signInAsAdmin(page);
  const session = (await (await page.request.get("/api/auth/session")).json()) as { data: { activeAccountId: string } };
  const adminId = session.data.activeAccountId;
  expect((await page.request.get("/api/me/token")).status()).toBe(200);
  expect((await page.request.post("/api/admin/cleanup")).status()).toBe(200);

  await page.goto("/admin/server");
  const log = page.getByRole("main").getByRole("region", { name: "Audit log" });
  await log.getByRole("textbox", { name: "Account ID" }).fill(adminId);
  const entries = log.getByRole("list", { name: "Audit entries" }).getByRole("listitem");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Ran cleanup");
  await expect(entries.nth(1)).toContainText("Viewed admin token");
  await expect(entries.nth(1)).toContainText(adminId);
  await expect(entries.nth(1).getByText(/•••/)).toBeVisible();
  await expect(entries.nth(1).locator("time")).toHaveText(/\d/);

  await log.getByRole("button", { name: "Tokens" }).click();
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("Viewed admin token");
  await log.getByRole("button", { name: "Sign-up" }).click();
  await expect(log.getByText("No entries match.")).toBeVisible();

  await log.getByRole("textbox", { name: "Account ID" }).fill("nope");
  await expect(log.getByText("Account IDs are 12 letters and digits.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("shows live server measurements", async ({ page }) => {
  await signInAsAdmin(page);
  // The page stays live through a server-sent event stream opened on load.
  const stream = page.waitForResponse((res) => res.url().endsWith("/api/admin/server/stream"));
  await page.goto("/admin/server");
  const main = page.getByRole("main");
  for (const card of ["Disk", "CPU", "Memory", "Network out"]) await expect(main.getByRole("region", { name: card, exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: "CPU", exact: true }).getByText(/^\d+ cores · load \d+(\.\d{1,2})?$/)).toBeVisible();

  const bandwidth = main.getByRole("region", { name: "Outbound bandwidth" });
  await expect(bandwidth.getByRole("heading", { name: "Outbound bandwidth · last 48h" })).toBeVisible();
  await expect(bandwidth.getByText("AVG 48H")).toBeVisible();
  await expect(bandwidth.getByText("UPTIME")).toBeVisible();
  await expect(bandwidth.getByText("ACCOUNTS")).toBeVisible();
  await expect(main.getByRole("region", { name: "Disk activity" }).getByRole("heading", { name: "Disk read / write · last 48h" })).toBeVisible();

  const services = main.getByRole("region", { name: "Services" });
  for (const name of ["Web server", "Media streaming", "Cleanup job", "Disk health", "Backup check"]) await expect(services.getByText(name, { exact: true })).toBeVisible();
  await expect(services.getByText("RUNNING").first()).toBeVisible();

  expect((await stream).headers()["content-type"]).toBe("text/event-stream");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
