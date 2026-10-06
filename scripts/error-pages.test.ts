import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderErrorPages } from "./error-pages";

describe("Nginx error pages", () => {
  const pages = renderErrorPages();

  it("are committed exactly as generated (npm run deploy:error-pages)", () => {
    for (const [name, html] of Object.entries(pages)) {
      expect(readFileSync(new URL(`../deploy/error-pages/${name}`, import.meta.url), "utf8"), name).toBe(html);
    }
  });

  it("are self-contained: inline styles and icons, no scripts or external requests", () => {
    for (const html of Object.values(pages)) {
      expect(html).toContain("--accent: #38bdf8;");
      expect(html).toContain("<svg");
      expect(html).not.toMatch(/<script|<link|src="http|url\(/);
    }
    expect(pages["502.html"]).toContain("Server unreachable");
    expect(pages["503.html"]).toContain("Under maintenance");
    expect(pages["504.html"]).toContain(">504<");
  });
});
