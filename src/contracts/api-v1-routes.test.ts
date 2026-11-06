import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { API_V1_ROUTES } from "./api-v1-routes";

const V1_DIR = join(process.cwd(), "src/app/api/v1");

/** Route files under src/app/api/v1 with the HTTP methods they export, as OpenAPI paths. */
function exportedEndpoints(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "route.ts") {
        const route = `/api/v1/${relative(V1_DIR, dir).split(sep).join("/")}`.replace(/\/$/, "").replace(/\[(\w+)\]/g, "{$1}");
        for (const [, method] of readFileSync(path, "utf8").matchAll(/^export const (GET|HEAD|POST|PUT|PATCH|DELETE)\b/gm)) found.push(`${method} ${route}`);
      }
    }
  };
  walk(V1_DIR);
  return found.sort();
}

describe("API_V1_ROUTES", () => {
  it("lists exactly the endpoints the route files export", () => {
    expect(API_V1_ROUTES.map((route) => `${route.method} ${route.path}`).sort()).toEqual(exportedEndpoints());
  });
});
