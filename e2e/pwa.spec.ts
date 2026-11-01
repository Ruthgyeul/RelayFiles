import { SHARE_TARGET } from "../src/config/policy";
import { expect, test } from "./fixtures";

const shared = [
  { name: "from-phone.txt", mimeType: "text/plain", buffer: Buffer.from("shared from another app") },
  { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes") },
];

test("serves the web app manifest, its icons and the service worker", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await res.json()) as { icons: { src: string; purpose: string }[]; [key: string]: unknown };
  expect(manifest).toMatchObject({
    name: "RelayFiles",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1419",
    theme_color: "#12181e",
    share_target: { action: SHARE_TARGET.action, method: "POST", enctype: "multipart/form-data", params: { files: [{ name: SHARE_TARGET.filesField, accept: ["*/*"] }] } },
  });
  expect(manifest.icons.map((icon) => icon.purpose)).toContain("maskable");
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
  }

  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(worker.headers()["cache-control"]).toBe("no-cache");
});

test("a share post the service worker did not take stores nothing and explains why", async ({ page }) => {
  const res = await page.request.post(SHARE_TARGET.action, { multipart: { [SHARE_TARGET.filesField]: shared[0]! }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toBe(`${SHARE_TARGET.page}?error=unavailable`);
  await page.goto(res.headers().location!);
  await expect(page.getByRole("heading", { name: "Sharing isn't ready yet" })).toBeVisible();
});

test("uploads files shared to the installed app into a new Home folder after a tap", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // The system share sheet posts the files as a multipart form navigation; a form does the same here.
  await page.evaluate(({ action, field }) => {
    const form = Object.assign(document.createElement("form"), { id: "share-sheet", method: "post", enctype: "multipart/form-data", action });
    form.append(Object.assign(document.createElement("input"), { type: "file", name: field, multiple: true }));
    document.body.append(form);
  }, { action: SHARE_TARGET.action, field: SHARE_TARGET.filesField });
  await page.locator("#share-sheet input").setInputFiles(shared);
  await page.locator("#share-sheet").evaluate((form: HTMLFormElement) => form.submit());

  await expect(page).toHaveURL(/\/share-target\?share=[0-9a-f-]{36}$/);
  const shareUrl = page.url();
  const card = page.getByRole("region", { name: "Upload shared files" });
  await expect(card.getByRole("heading", { name: "Upload shared files" })).toBeVisible();
  await expect(card.getByText(/^2 files · 30 B · they go to a new folder in Home$/)).toBeVisible();
  await expect(card.getByRole("list", { name: "Shared files" }).getByRole("listitem")).toHaveText([/from-phone\.txt\s*23 B/, /notes\.md\s*7 B/]);

  await card.getByRole("button", { name: "Upload to Home" }).click();
  await expect(page).toHaveURL(/\/files\/[a-z0-9]+$/);
  await expect(page.locator('[data-item="from-phone.txt"]')).toBeVisible();
  await expect(page.locator('[data-item="notes.md"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "Transfers" }).getByText("COMPLETE")).toBeVisible();

  // The worker hands the files out once.
  await page.goto(shareUrl);
  await expect(page.getByRole("heading", { name: "Nothing to upload" })).toBeVisible();
});
