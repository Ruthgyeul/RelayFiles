import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FolderView } from "@/contracts/nodes";
import { newFolder, openFiles } from "./helpers";

/** 1×1 PNG, detected as an image by the server. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/**
 * Serious and critical WCAG 2.1 A/AA problems fail the test. Colour contrast is reported as an
 * annotation instead: the palette is the design's (docs/design), changed only with the design.
 */
async function audit(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const violation of violations.filter((item) => item.id === "color-contrast")) {
    test.info().annotations.push({ type: "contrast", description: violation.nodes.map((node) => node.html.slice(0, 120)).join(" | ") });
  }
  const blocking = violations.filter((violation) => violation.id !== "color-contrast" && (violation.impact === "serious" || violation.impact === "critical"));
  expect(blocking.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.html.slice(0, 300)).join(" | ")})`)).toEqual([]);
}

test("app pages have no serious accessibility problems", async ({ page }) => {
  await openFiles(page);
  await audit(page);
  for (const [path, heading] of [
    ["/", "Home"],
    ["/settings", "My Profile"],
    ["/status", "Status"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await audit(page);
  }
});

test("dialogs and error pages have no serious accessibility problems", async ({ page }) => {
  await openFiles(page);
  await page.getByRole("button", { name: "New folder" }).first().click();
  await expect(page.getByRole("dialog", { name: "New folder" })).toBeVisible();
  await audit(page);
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Search all files" })).toBeVisible();
  await audit(page);

  await page.goto("/files/nothinghere1");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await audit(page);
});

test("share pages, the viewer and admin pages have no serious accessibility problems", async ({ page }) => {
  await openFiles(page);
  await newFolder(page, "Trip");
  const trip = ((await (await page.request.get("/api/folders/root")).json()) as { data: FolderView }).data.children.find((item) => item.name === "Trip")!;
  await page.request.put(`/api/nodes/${trip.id}/settings`, {
    data: { visibility: "public", expiry: "Never", burn: false, downloadLimit: null, access: "both", note: "Bring sunscreen", applyDown: false },
  });
  await page.goto(`/d/${trip.linkId}`);
  await expect(page.getByText("Bring sunscreen")).toBeVisible();
  await audit(page);

  await page.goto("/files");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([{ name: "dot.png", mimeType: "image/png", buffer: PNG }]);
  await page.locator('[data-item="dot.png"]').getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("dialog", { name: "dot.png" })).toBeVisible();
  await audit(page);

  const out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/admin-create.mts"], { encoding: "utf8" });
  const token = /^\s*token\s+(\S+)\s*$/m.exec(out)![1]!;
  expect((await page.request.post("/api/auth/token", { data: { token } })).status()).toBe(200);
  for (const [path, heading] of [
    ["/admin/accounts", "Accounts"],
    ["/admin/server", "Server"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await audit(page);
  }
});
