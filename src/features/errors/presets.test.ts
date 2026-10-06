import { describe, expect, it } from "vitest";
import { ERROR_PAGE_CODES } from "@/contracts/errors";
import { isIconName } from "@/shared/ui/icon/registry";
import { ERROR_PRESETS, formatCountdown } from "./presets";

describe("error presets", () => {
  it("cover every error page code with a registered icon", () => {
    for (const code of ERROR_PAGE_CODES) {
      const preset = ERROR_PRESETS[code];
      expect(preset.title, code).toBeTruthy();
      expect(isIconName(preset.icon), preset.icon).toBe(true);
    }
  });

  it("use danger for 4xx and warn for 5xx (CLAUDE.md color rules)", () => {
    for (const code of ["400", "403", "404", "410", "429"] as const) expect(ERROR_PRESETS[code].tone).toBe("danger");
    for (const code of ["500", "503", "storage-offline"] as const) expect(ERROR_PRESETS[code].tone).toBe("warn");
  });
});

describe("formatCountdown", () => {
  it("formats m:ss and never goes negative", () => {
    expect(formatCountdown(30)).toBe("0:30");
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(0.2)).toBe("0:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});
