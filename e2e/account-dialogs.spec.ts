import { expect, test, type Locator } from "@playwright/test";

async function css(locator: Locator, property: string): Promise<string> {
  return locator.first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByTestId("open-sign-in").click();
});

test("sign-in dialog matches the design", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  await expect(dialog).toBeVisible();
  const width = Number((await css(dialog, "width")).replace("px", ""));
  const viewport = page.viewportSize()!.width;
  expect(width).toBe(Math.min(420, viewport - 24));
  const input = dialog.getByPlaceholder("40-character token");
  expect(await css(input, "height")).toBe("44px");
  expect(await css(input, "font-size")).toBe("13px");
  expect(await css(input, "border-radius")).toBe("10px");
  const submit = dialog.getByRole("button", { name: "Sign in with token" });
  expect(await css(submit, "height")).toBe("44px");
  expect(await css(submit, "font-size")).toBe("15px");
  expect(await css(submit, "background-color")).toBe("rgb(56, 189, 248)");
  await expect(dialog.getByText("A unique name, ID and token are generated for you.")).toBeVisible();
});

test("failed sign-ins count down to a lockout", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  const input = dialog.getByPlaceholder("40-character token");
  const submit = dialog.getByRole("button", { name: "Sign in with token" });
  for (let attempt = 1; attempt <= 4; attempt++) {
    await input.fill("short");
    await submit.click();
    await expect(dialog.getByRole("alert")).toHaveText(`Tokens are 40 characters. ${5 - attempt} attempts left before a lockout.`);
  }
  await submit.click();
  const lock = dialog.getByRole("status");
  await expect(lock).toContainText(/Too many failed attempts\. Try again in 0:(30|29)\./);
  expect(await css(lock, "background-color")).toBe("rgb(58, 29, 36)");
});

test("creating an account shows the token dialog that requires confirmation", async ({ page }) => {
  await page.getByRole("dialog", { name: "Sign in" }).getByRole("button", { name: "Create anonymous account" }).click();
  const dialog = page.getByRole("dialog", { name: "Save your account token" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("new-token")).toHaveText(/^[A-Za-z0-9]{40}$/);
  expect(await css(page.getByTestId("new-token"), "color")).toBe("rgb(245, 213, 138)");
  const proceed = dialog.getByRole("button", { name: "Continue" });
  expect(await css(proceed, "background-color")).toBe("rgb(42, 51, 80)");
  await expect(proceed).toBeDisabled();
  await page.keyboard.press("Escape");
  await proceed.click({ force: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "I've saved my token somewhere safe" }).click();
  expect(await css(proceed, "background-color")).toBe("rgb(56, 189, 248)");
  await proceed.click();
  await expect(dialog).toBeHidden();
});

test("closed and invite-only servers change the sign-up options", async ({ page }) => {
  await page.keyboard.press("Escape");
  await page.locator('[data-signup-mode="closed"]').click();
  await page.getByTestId("open-sign-in").click();
  await expect(page.getByText(/New sign-ups are closed on this server/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('[data-signup-mode="invite"]').click();
  await page.getByTestId("open-sign-in").click();
  await expect(page.getByPlaceholder("Invite code · XXXX-XXXX")).toBeVisible();
});
