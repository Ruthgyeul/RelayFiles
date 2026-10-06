import { expect, test, type Locator, type Page } from "@playwright/test";

/** Computed style of the first element matched by the locator. */
async function css(locator: Locator, property: string): Promise<string> {
  return locator.first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

async function rootVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
});

test("uses the Slate Sky theme and design fonts by default", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sky");
  expect(await rootVar(page, "--bg")).toBe("#0f1419");
  expect(await rootVar(page, "--accent")).toBe("#38bdf8");
  expect(await css(page.locator("body"), "background-color")).toBe("rgb(15, 20, 25)");
  expect(await css(page.locator("body"), "font-family")).toMatch(/Figtree/i);
});

test("primary button matches the design (h34, radius 10, weight 700, accent)", async ({ page }) => {
  const button = page.getByTestId("button-primary");
  expect(await css(button, "height")).toBe("34px");
  expect(await css(button, "border-radius")).toBe("10px");
  expect(await css(button, "font-weight")).toBe("700");
  expect(await css(button, "font-size")).toBe("13px");
  expect(await css(button, "background-color")).toBe("rgb(56, 189, 248)");
  expect(await css(button, "color")).toBe("rgb(6, 20, 28)");
});

test("button heights follow the design scale", async ({ page }) => {
  for (const size of [28, 30, 32, 34, 36, 38, 40, 44]) {
    expect(await css(page.getByTestId(`button-size-${size}`), "height"), `h${size}`).toBe(`${size}px`);
  }
  expect(await css(page.getByTestId("button-size-28"), "border-radius")).toBe("8px");
  expect(await css(page.getByTestId("button-size-44"), "font-size")).toBe("15px");
});

test("card, pill and input tokens", async ({ page }) => {
  const card = page.getByTestId("card");
  expect(await css(card, "border-radius")).toBe("16px");
  expect(await css(card, "border-top-color")).toBe("rgb(39, 49, 59)");
  expect(await css(card, "background-color")).toBe("rgb(24, 32, 40)");

  const pill = page.getByText("COMPLETE", { exact: true });
  expect(await css(pill, "font-size")).toBe("10px");
  expect(await css(pill, "font-weight")).toBe("800");
  expect(await css(pill, "background-color")).toBe("rgb(18, 60, 51)");

  const input = page.getByTestId("text-input");
  expect(await css(input, "height")).toBe("40px");
  expect(await css(input, "border-radius")).toBe("10px");
  expect(await css(input, "font-size")).toBe("15px");
});

test("menu items are 36px, or 44px below 720px", async ({ page }, testInfo) => {
  const item = page.getByRole("menu", { name: "File actions" }).getByRole("menuitem").first();
  const expected = testInfo.project.name === "mobile" ? "44px" : "36px";
  expect(await css(item, "height")).toBe(expected);
  expect(await css(page.getByRole("menu", { name: "File actions" }), "border-radius")).toBe("12px");
});

test("modal is capped at the viewport width minus 24px and closes on Escape", async ({ page }) => {
  await page.getByTestId("open-modal").click();
  const dialog = page.getByRole("dialog", { name: "Folder settings · Example" });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(Math.round(box.width)).toBe(Math.min(480, viewport.width - 24));
  expect(await css(dialog, "border-radius")).toBe("16px");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("switching theme updates the palette", async ({ page }) => {
  await page.getByRole("button", { name: "Graphite Lime" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "lime");
  expect(await rootVar(page, "--accent")).toBe("#c6f24e");
});

test("has no horizontal scroll", async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
