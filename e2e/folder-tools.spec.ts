import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { names, openFiles } from "./helpers";

const file = (name: string, content: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(content) });

async function upload(page: Page, files: ReturnType<typeof file>[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByRole("region", { name: "Transfers" }).getByText("COMPLETE")).toBeVisible();
  await page.getByRole("button", { name: "Close transfers" }).click();
}

async function folderTool(page: Page, entry: string) {
  await page.getByRole("button", { name: "Folder menu" }).click();
  await page.getByRole("menuitem", { name: entry }).click();
}

test("renumbers the files of a folder in the chosen order", async ({ page }) => {
  await openFiles(page);
  await upload(page, [file("c.txt", "3"), file("a.txt", "1"), file("b.txt", "2")]);
  await expect.poll(() => names(page)).toEqual(["a.txt", "b.txt", "c.txt"]);

  await folderTool(page, "Renumber files");
  const dialog = page.getByRole("dialog", { name: "Renumber files" });
  const newNames = dialog.getByRole("list", { name: "New names" });
  await expect(newNames.getByRole("listitem")).toHaveText(["a.txt01.txt", "b.txt02.txt", "c.txt03.txt"]);
  // Text files have no date taken: they are placed by their modification time, and the dialog says so.
  await dialog.getByRole("button", { name: "Date taken" }).click();
  await expect(dialog.getByText(/3 without a date taken/)).toBeVisible();
  await dialog.getByRole("button", { name: "Date created" }).click();
  await expect(newNames.getByRole("listitem").first()).toHaveText("c.txt01.txt");
  await dialog.getByRole("button", { name: "Newest first" }).click();
  await expect(newNames.getByRole("listitem").first()).toHaveText("b.txt01.txt");
  await dialog.getByRole("button", { name: "Renumber 3 files" }).click();

  await expect(page.getByText("Renumbered 3 files")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect.poll(() => names(page)).toEqual(["01.txt", "02.txt", "03.txt"]);
});

test("finds files with the same content and deletes the extra copy", async ({ page }) => {
  await openFiles(page);
  await upload(page, [file("x.txt", "same"), file("y.txt", "same"), file("z.txt", "different")]);

  await folderTool(page, "Find duplicates");
  const dialog = page.getByRole("dialog", { name: "Find duplicates" });
  await expect(dialog.getByText("2 copies")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Delete x.txt" })).toHaveAttribute("aria-checked", "false");
  await expect(dialog.getByRole("checkbox", { name: "Delete y.txt" })).toHaveAttribute("aria-checked", "true");

  // Every copy selected: nothing can be deleted.
  await dialog.getByRole("checkbox", { name: "Delete x.txt" }).click();
  await expect(dialog.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Delete x.txt" }).click();

  await dialog.getByRole("button", { name: "Delete selected" }).click();
  await page.getByRole("dialog", { name: "Delete 1 file?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted 1 file")).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["x.txt", "z.txt"]);

  await folderTool(page, "Find duplicates");
  await expect(page.getByRole("dialog", { name: "Find duplicates" }).getByText("No duplicates found")).toBeVisible();
});
