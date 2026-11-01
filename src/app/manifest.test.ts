import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARE_TARGET } from "@/config/policy";
import manifest from "./manifest";

describe("web app manifest", () => {
  const app = manifest();

  it("opens the app at the root as a standalone window", () => {
    expect(app).toMatchObject({ name: "RelayFiles", short_name: "RelayFiles", start_url: "/", scope: "/", display: "standalone" });
  });

  it("lists icons that exist, with a maskable one", () => {
    for (const icon of app.icons ?? []) expect(existsSync(join("public", icon.src)), icon.src).toBe(true);
    expect(app.icons?.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  });

  it("takes shared files of any type as a multipart post", () => {
    expect(app.share_target).toEqual({ action: SHARE_TARGET.action, method: "POST", enctype: "multipart/form-data", params: { files: [{ name: "files", accept: ["*/*"] }] } });
  });
});
