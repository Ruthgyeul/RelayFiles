import { describe, expect, it } from "vitest";
import { EnvError, logLevelOf, parseEnv } from "./env";

describe("parseEnv", () => {
  it("applies defaults for an empty environment", () => {
    const env = parseEnv({});
    expect(env).toEqual({
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      DEFAULT_THEME: "sky",
    });
  });

  it("accepts every theme key from the design", () => {
    for (const theme of ["blue", "lime", "coral", "amber", "teal", "mono", "plum", "crimson", "forest", "sky"]) {
      expect(parseEnv({ DEFAULT_THEME: theme }).DEFAULT_THEME).toBe(theme);
    }
  });

  it("rejects an unknown theme and an invalid URL with readable issues", () => {
    try {
      parseEnv({ DEFAULT_THEME: "neon", PUBLIC_URL: "not a url" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const issues = (error as EnvError).issues.join("\n");
      expect(issues).toContain("DEFAULT_THEME");
      expect(issues).toContain("PUBLIC_URL");
    }
  });
});

describe("logLevelOf", () => {
  it("defaults to warn in production and debug in development", () => {
    expect(logLevelOf(parseEnv({ NODE_ENV: "production" }))).toBe("warn");
    expect(logLevelOf(parseEnv({ NODE_ENV: "development" }))).toBe("debug");
  });

  it("prefers an explicit LOG_LEVEL", () => {
    expect(logLevelOf(parseEnv({ NODE_ENV: "production", LOG_LEVEL: "info" }))).toBe("info");
  });
});
