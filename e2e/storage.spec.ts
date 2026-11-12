import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newFolder, openFiles } from "./helpers";

async function uploadText(page: Page, name: string, content: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
  await expect(page.locator(`[data-item="${name}"]`)).toBeVisible({ timeout: 15_000 });
}

test("shows where the space goes and deletes a large file from there", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Empty");
  await uploadText(page, "big.txt", "x".repeat(2_000));
  await uploadText(page, "small.txt", "x".repeat(10));

  await page.getByRole("link", { name: "Storage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Storage" })).toBeVisible();
  const bars = page.getByRole("list", { name: "Space by item" }).getByRole("listitem");
  await expect(bars).toHaveCount(2);
  await expect(bars.first()).toContainText("big.txt");
  const largest = page.getByRole("list", { name: "Largest files list" }).getByRole("listitem");
  await expect(largest).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Not opened lately" }).getByText("Nothing here.")).toBeVisible();

  await largest.first().getByRole("checkbox", { name: "Select big.txt" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: 'Delete "big.txt"?' }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("1 item deleted")).toBeVisible();
  await expect(largest).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Space used" }).getByRole("link", { name: /^Recently deleted 2\.0 KB$/ })).toBeVisible();
});
