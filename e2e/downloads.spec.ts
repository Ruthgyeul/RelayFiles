import { expect, test } from "./fixtures";
import { names, openFiles } from "./helpers";

const file = (name: string, content: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(content) });

test("saves a selection into a picked folder with per-file progress, never replacing a file", async ({ page }) => {
  // The browser's private file system stands in for the folder the user would pick.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { value: () => navigator.storage.getDirectory() });
  });
  await openFiles(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([file("a.txt", "alpha"), file("b.txt", "bravo")]);
  await expect.poll(() => names(page)).toEqual(["a.txt", "b.txt"]);
  await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const writable = await (await dir.getFileHandle("a.txt", { create: true })).createWritable();
    await writable.write("already here");
    await writable.close();
  });
  await page.getByRole("button", { name: "Close transfers" }).click();

  await page.getByRole("checkbox", { name: "Select all" }).click();
  await page.getByRole("toolbar", { name: "Files" }).getByRole("button", { name: "Download", exact: true }).click();
  const panel = page.getByRole("region", { name: "Transfers" });
  await expect(panel.getByText("COMPLETE")).toBeVisible();
  await expect(panel.getByText(/2 files · 10 B · in 0:0\d · saved/)).toBeVisible();
  // The download is the newest card, above the upload.
  await panel.getByRole("button", { name: "Show files" }).first().click();
  await expect(panel.getByRole("list", { name: /^Files in 2 items from / }).getByRole("listitem")).toHaveText([/a\.txt.*Saved/, /b\.txt.*Saved/]);

  const saved = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const read = async (name: string) => (await (await dir.getFileHandle(name)).getFile()).text();
    return { a: await read("a.txt"), a2: await read("a (2).txt"), b: await read("b.txt") };
  });
  expect(saved).toEqual({ a: "already here", a2: "alpha", b: "bravo" });
});
