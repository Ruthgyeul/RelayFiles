import { expect, test, type Page } from "@playwright/test";
import { names, openFiles } from "./helpers";

const file = (name: string, content: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(content) });

async function choose(page: Page, trigger: () => Promise<void>, files: ReturnType<typeof file>[]) {
  const chooser = page.waitForEvent("filechooser");
  await trigger();
  await (await chooser).setFiles(files);
}

test("uploads from Home into a new folder and shows its link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await choose(page, () => page.getByRole("button", { name: "Choose files to upload" }).click(), [file("holiday.txt", "sun and sea")]);

  const panel = page.getByRole("region", { name: "Transfers" });
  await expect(panel.getByText("COMPLETE")).toBeVisible();
  await expect(panel.getByText(/1 file · 11 B · in 0:0\d · uploaded/)).toBeVisible();
  await expect(page.getByText("holiday is ready")).toBeVisible();
  await expect(page.getByRole("region", { name: "Last upload" }).getByText(/\/d\/[a-z0-9]{10}$/)).toBeVisible();

  await panel.getByRole("button", { name: "Close transfers" }).click();
  await expect(page.getByRole("button", { name: "Transfers · 1" })).toBeVisible();
  await page.getByRole("region", { name: "Last upload" }).getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "holiday" })).toBeVisible();
  await expect(page.locator('[data-item="holiday.txt"]')).toContainText("11 B");
});

test("asks about duplicates and keeps both", async ({ page }) => {
  await openFiles(page);
  await choose(page, () => page.getByRole("button", { name: "Upload", exact: true }).click(), [file("a.txt", "one")]);
  await expect.poll(() => names(page)).toEqual(["a.txt"]);

  await choose(page, () => page.getByRole("button", { name: "Upload", exact: true }).click(), [file("a.txt", "two")]);
  const dialog = page.getByRole("dialog", { name: "1 file already exists in root" });
  await expect(dialog.getByText("a.txt")).toBeVisible();
  await dialog.getByRole("button", { name: /Keep both/ }).click();
  await expect.poll(() => names(page)).toEqual(["a (2).txt", "a.txt"]);

  await choose(page, () => page.getByRole("button", { name: "Upload", exact: true }).click(), [file("a.txt", "three")]);
  await page.getByRole("dialog", { name: "1 file already exists in root" }).getByRole("button", { name: /Skip duplicates/ }).click();
  await expect(page.getByText("Nothing to upload · all files already exist")).toBeVisible();
});

test("pauses while offline and resumes by itself", async ({ page, context }) => {
  await openFiles(page);
  // Hold the upload body so the connection can drop mid-transfer.
  let held = 0;
  await page.route("**/api/uploads/tus/**", async (route) => {
    if (route.request().method() === "PATCH" && held++ === 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue().catch(() => undefined);
  });
  await choose(page, () => page.getByRole("button", { name: "Upload", exact: true }).click(), [file("big.bin", "x".repeat(200_000), "application/octet-stream")]);
  const panel = page.getByRole("region", { name: "Transfers" });
  await expect(panel.getByText("UPLOADING")).toBeVisible();
  await context.setOffline(true);
  await expect(panel.getByText("PAUSED")).toBeVisible();
  await expect(panel.getByText(/connection lost, resumes automatically/)).toBeVisible();
  await context.setOffline(false);
  await expect(panel.getByText("COMPLETE")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => names(page)).toEqual(["big.bin"]);
});
