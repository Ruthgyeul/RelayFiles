import { test as base, expect, type Page } from "@playwright/test";

/** Chromium logs every CSP violation (enforced or report-only) as a console error like this. */
const CSP_VIOLATION = /Content Security Policy/i;

/**
 * Every spec's `test`: fails a test whose pages hit the Content-Security-Policy, so a viewer,
 * script or style the policy would block (CSP_MODE=enforce) shows up in E2E, not in production.
 */
export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    async ({ context }, use) => {
      const violations: string[] = [];
      const watch = (page: Page) =>
        page.on("console", (message) => {
          if (message.type() === "error" && CSP_VIOLATION.test(message.text())) violations.push(`${page.url()}: ${message.text()}`);
        });
      context.pages().forEach(watch);
      context.on("page", watch);
      await use();
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
