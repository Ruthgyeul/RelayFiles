import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { configPath, loadConfig, normalizeServer, saveConfig } from "./config.ts";

describe("configPath", () => {
  it("follows RELAYFILES_CONFIG, then XDG_CONFIG_HOME", () => {
    assert.equal(configPath({ RELAYFILES_CONFIG: "/x/c.json" }), "/x/c.json");
    assert.equal(configPath({ XDG_CONFIG_HOME: "/cfg" }), "/cfg/relayfiles/config.json");
  });
});

describe("normalizeServer", () => {
  it("keeps the origin and path without trailing slashes", () => {
    assert.equal(normalizeServer("https://files.example/"), "https://files.example");
    assert.equal(normalizeServer(" https://example.org/relay// "), "https://example.org/relay");
  });

  it("refuses other schemes", () => {
    assert.throws(() => normalizeServer("ftp://files.example"));
    assert.throws(() => normalizeServer("files.example"));
  });
});

describe("saveConfig and loadConfig", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relayfiles-cli-"));
  after(() => rm(dir, { recursive: true, force: true }));

  it("saves a file only the user can read and reads it back", async () => {
    const path = join(dir, "nested", "config.json");
    await saveConfig({ server: "https://files.example", token: "rfp_test" }, path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await loadConfig({}, path), { server: "https://files.example", token: "rfp_test" });
  });

  it("lets the environment override the saved login, and says when there is none", async () => {
    const path = join(dir, "nested", "config.json");
    assert.deepEqual(await loadConfig({ RELAYFILES_TOKEN: "rfp_env" }, path), { server: "https://files.example", token: "rfp_env" });
    await assert.rejects(loadConfig({}, join(dir, "missing.json")), /Not signed in/);
  });
});
