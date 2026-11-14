import { expect, test } from "./fixtures";
import { newFolder, openFiles } from "./helpers";

test("a folder made in one tab shows up in another without a reload", async ({ page, context }) => {
  await openFiles(page);
  // The same account in a second tab, on the same folder.
  const other = await context.newPage();
  await other.goto("/files");
  await expect(other.getByRole("heading", { level: 1, name: "root" })).toBeVisible();

  await newFolder(page, "Made elsewhere");
  // The other tab hears the change (GET /api/events) and reloads what it shows.
  await expect(other.getByText("Made elsewhere")).toBeVisible({ timeout: 10_000 });
  await other.close();
});
