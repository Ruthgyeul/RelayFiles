/**
 * Writes Nginx's static error pages to deploy/error-pages (npm run deploy:error-pages).
 * Run after changing the error presets or the palette; a test keeps the files in sync.
 */
import { writeFileSync } from "node:fs";
import { renderErrorPages } from "./error-pages";

const dir = new URL("../deploy/error-pages/", import.meta.url);
for (const [name, html] of Object.entries(renderErrorPages())) {
  writeFileSync(new URL(name, dir), html);
  console.log(`deploy/error-pages/${name}`);
}
