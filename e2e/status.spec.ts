import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

async function signInAsAdmin(page: Page) {
  const out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/admin-create.mts"], { encoding: "utf8" });
  const token = /^\s*token\s+(\S+)\s*$/m.exec(out)![1]!;
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  expect((await page.request.post("/api/auth/token", { data: { token } })).status()).toBe(200);
}

test("measures this browser's connection and lists the services", async ({ page }) => {
  await page.goto("/status");
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
  const overall = main.getByRole("region", { name: "Overall status" });
  await expect(overall.getByText(/^Last checked .* · checks every 2\.5 s while this page is open$/)).toBeVisible();
  await expect(overall.getByRole("heading", { name: "All systems operational" })).toBeVisible();

  const connection = main.getByRole("region", { name: "Your connection" });
  await expect(connection.getByText("Online", { exact: true })).toBeVisible();
  await expect(connection.getByText(/^\d+ of \d+ checks$/)).toBeVisible();
  await expect(connection.getByText("Latency · last 48 hours")).toBeVisible();

  const services = main.getByRole("region", { name: "Services" });
  for (const name of ["Website", "Uploads", "Streaming", "Downloads", "Share links", "Storage"]) await expect(services.getByText(name, { exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: "Server" }).getByText("Response p50 / p95")).toBeVisible();
  // Members see incidents but can't post them.
  await expect(main.getByRole("region", { name: "Incidents" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Post incident" })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("admins post, edit and delete incidents", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/status");
  const incidents = page.getByRole("main").getByRole("region", { name: "Incidents" });
  const title = `Slow streaming ${Date.now()}`;

  await incidents.getByRole("button", { name: "Post incident" }).click();
  const dialog = page.getByRole("dialog", { name: "Post incident" });
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog.getByText("Title is required.")).toBeVisible();
  await dialog.getByPlaceholder("e.g. Slow streaming").fill(title);
  await dialog.getByRole("button", { name: "Major" }).click();
  await dialog.getByPlaceholder("e.g. 25 min").fill("25 min");
  await dialog.getByPlaceholder("What happened and what was done").fill("A disk cache was rebuilt.");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Incident posted")).toBeVisible();

  const item = incidents.getByRole("article", { name: title });
  await expect(item.getByText("MAJOR")).toBeVisible();
  await expect(item.getByText(/ · 25 min · Ongoing$/)).toBeVisible();
  await expect(item.getByText("A disk cache was rebuilt.")).toBeVisible();

  await item.getByRole("button", { name: `Edit ${title}` }).click();
  const edit = page.getByRole("dialog", { name: "Edit incident" });
  await edit.getByRole("checkbox", { name: "Resolved" }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Incident updated")).toBeVisible();
  await expect(item.getByText(/ · 25 min · Resolved$/)).toBeVisible();

  await item.getByRole("button", { name: `Delete ${title}` }).click();
  await page.getByRole("dialog", { name: "Delete this incident?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Incident deleted")).toBeVisible();
  await expect(item).toHaveCount(0);
});
