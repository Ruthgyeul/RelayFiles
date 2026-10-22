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

/** A one-page PDF with a line of text (objects and cross-reference table written by hand). */
export function onePagePdf(text = "RelayFiles"): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
