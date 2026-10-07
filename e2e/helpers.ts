import { expect, type Page } from "@playwright/test";

/** Opens the File Manager as a fresh visitor (an anonymous account is created first). */
export async function openFiles(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/^You're signed in as anon-/)).toBeVisible();
  await page.goto("/files");
  await expect(page.getByRole("heading", { level: 1, name: "root" })).toBeVisible();
}

/** Creates a folder in the current folder through the New folder dialog. */
export async function newFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New folder" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(`[data-item="${name}"]`)).toBeVisible();
}

export async function itemMenu(page: Page, name: string, entry: string) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: entry }).click();
}

export const names = (page: Page) => page.locator("[data-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-item")));

const WAV_RATE = 8000;
const WAV_HEADER_BYTES = 44;
const SILENCE_8BIT = 0x80;

/** A short silent WAV (8-bit mono), detected as audio by the server. */
export function silentWav(ms = 250): Buffer {
  const samples = Math.round((WAV_RATE * ms) / 1000);
  const wav = Buffer.alloc(WAV_HEADER_BYTES + samples, SILENCE_8BIT);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(WAV_HEADER_BYTES - 8 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(WAV_RATE, 24);
  wav.writeUInt32LE(WAV_RATE, 28); // bytes per second
  wav.writeUInt16LE(1, 32); // block align
  wav.writeUInt16LE(8, 34); // bits per sample
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return wav;
}
