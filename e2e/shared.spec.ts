import type { FolderView } from "@/contracts/nodes";
import { expect, test } from "./fixtures";
import { newFolder, openFiles } from "./helpers";

test("lists what is shared and makes it private from there", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Trip");
  await newFolder(page, "Notes");
  const children = ((await (await page.request.get("/api/folders/root")).json()) as { data: FolderView }).data.children;
  const share = (name: string, downloadLimit: number | null) =>
    page.request.put(`/api/nodes/${children.find((item) => item.name === name)!.id}/settings`, {
      data: { visibility: "public", expiry: "Never", burn: false, downloadLimit, access: "both", note: "", applyDown: false },
    });
  await share("Trip", null);
  await share("Notes", 5);

  await page.getByRole("link", { name: "Shared by me" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Shared by me" })).toBeVisible();
  const rows = page.getByRole("list", { name: "Shared items list" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Notes" })).toContainText("0 / 5 downloads");

  await page.getByRole("button", { name: "Limited 1" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "All 2" }).click();

  await page.getByRole("button", { name: "Make Trip private" }).click();
  await page.getByRole("dialog", { name: 'Make "Trip" private?' }).getByRole("button", { name: "Make private" }).click();
  await expect(page.getByText("1 item is private now")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Notes");
});
