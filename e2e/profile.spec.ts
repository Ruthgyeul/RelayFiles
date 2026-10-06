import { expect, test, type Page } from "@playwright/test";

async function openProfile(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "My Profile" })).toBeVisible();
  return page.getByRole("region", { name: "Profile" });
}

test("shows the account, its retention, usage and this device", async ({ page }) => {
  const profile = await openProfile(page);
  await expect(profile.getByRole("heading", { level: 2, name: /^anon-[a-z0-9]{6}$/ })).toBeVisible();
  await expect(profile.getByText("Anonymous")).toBeVisible();
  await expect(profile.getByText(/Deletes .* · 14 days left/)).toBeVisible();
  await expect(page.getByText(/^Anonymous account with its own private root folder\. It is deleted together with all of its files on .*, 14 days after it was created/)).toBeVisible();

  await expect(page.getByRole("region", { name: "Storage" })).toContainText("0 B / 5.0 GB");
  await expect(page.getByRole("region", { name: "Traffic" }).getByText("No data yet")).toBeVisible();
  await expect(page.getByRole("region", { name: "Content" })).toContainText("0Files");

  const devices = page.getByRole("region", { name: "Signed-in devices" });
  await expect(devices.getByText("1 device signed in to this account")).toBeVisible();
  await expect(devices.getByText("THIS DEVICE")).toBeVisible();
  await expect(devices.getByRole("button", { name: "Sign out all others" })).toHaveCount(0);
});

test("shows, copies and replaces the token", async ({ page }) => {
  await openProfile(page);
  const access = page.getByRole("region", { name: "Access & recovery" });
  const token = access.getByLabel("Account token", { exact: true });
  await expect(token).toHaveText(/^.{4}•{28}.{4}$/);
  await access.getByRole("button", { name: "Show token" }).click();
  await expect(token).toHaveText(/^[A-Za-z0-9]{40}$/);
  const first = await token.textContent();
  await access.getByRole("button", { name: "Copy token" }).click();
  await expect(page.getByText("Token copied")).toBeVisible();

  await access.getByRole("button", { name: "Generate a new token" }).click();
  await page.getByRole("dialog", { name: "Generate a new token?" }).getByRole("button", { name: "Generate" }).click();
  const save = page.getByRole("dialog", { name: "Save your account token" });
  await expect(save).toBeVisible();
  await save.getByRole("checkbox").click();
  await save.getByRole("button", { name: "Continue" }).click();
  await expect(save).toBeHidden();
  await access.getByRole("button", { name: "Show token" }).click();
  await expect(token).not.toHaveText(first!);
});

test("saves preferences and purges expired items", async ({ page }) => {
  await openProfile(page);
  const preferences = page.getByRole("region", { name: "Preferences" });
  const strip = preferences.getByRole("checkbox", { name: /Strip metadata on public links/ });
  await expect(strip).toHaveAttribute("aria-checked", "true");
  await strip.click();
  await expect(page.getByText("Public photos keep their metadata")).toBeVisible();
  await expect(strip).toHaveAttribute("aria-checked", "false");

  await preferences.getByRole("button", { name: "Purge now" }).click();
  await expect(page.getByText("No expired folders")).toBeVisible();
});

test("deletes the account after confirming", async ({ page }) => {
  const profile = await openProfile(page);
  const name = await profile.getByRole("heading", { level: 2 }).textContent();
  await page.getByRole("region", { name: "Delete account" }).getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("dialog", { name: "Delete this account?" }).getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText("Account deleted")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // Sign-ups are open, so the visitor gets a fresh anonymous account.
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await expect(page.getByText(`You're signed in as ${name}`)).toHaveCount(0);
});
