/**
 * Renders the installed app's icons from the site icon (src/app/icon.svg) with sharp. The PNGs
 * are committed (public/icons/, src/app/apple-icon.png); run this again after changing the icon:
 *   npx tsx scripts/pwa-icons.mts
 * - icon-192.png, icon-512.png ("any"): the icon as it is, rounded corners on transparency.
 * - maskable-512.png ("maskable"): square corners, the launcher cuts its own shape. The arrow
 *   already sits inside the maskable safe zone (the middle 80% circle), so nothing is scaled.
 * - apple-icon.png (180 px): iOS home screens round the corners themselves and show
 *   transparency as black, so it is square as well.
 */
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "src/app/icon.svg";
const OUT_DIR = "public/icons";
const ROUNDED_CORNER = / rx="\d+"/;
/** SVGs render at 72 dpi; the icon's viewBox is 64 units wide. */
const BASE_DPI = 72;
const VIEWBOX_SIZE = 64;

const svg = await readFile(SOURCE, "utf8");
if (!ROUNDED_CORNER.test(svg)) throw new Error(`${SOURCE}: expected the background <rect> to have rx="…"`);
const square = svg.replace(ROUNDED_CORNER, "");

async function render(source: string, size: number, out: string): Promise<void> {
  // Rendered at the target size from the vector (no upscaling), as an 8-bit palette PNG: a few KB.
  await sharp(Buffer.from(source), { density: (BASE_DPI * size) / VIEWBOX_SIZE })
    .resize(size, size)
    .png({ palette: true, compressionLevel: 9, effort: 10 })
    .toFile(out);
  console.log(`${out} (${size}x${size})`);
}

await mkdir(OUT_DIR, { recursive: true });
await render(svg, 192, `${OUT_DIR}/icon-192.png`);
await render(svg, 512, `${OUT_DIR}/icon-512.png`);
await render(square, 512, `${OUT_DIR}/maskable-512.png`);
await render(square, 180, "src/app/apple-icon.png");
