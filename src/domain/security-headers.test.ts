import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, parseCspReports, strictTransportSecurity } from "./security-headers";

describe("contentSecurityPolicy", () => {
  const directive = (policy: string, name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `));

  it("trusts scripts by nonce only and blocks plugins, base and framing", () => {
    const policy = contentSecurityPolicy({ nonce: "abc", dev: false });
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'none'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "img-src")).toBe("img-src 'self' blob: data:");
    expect(directive(policy, "report-uri")).toBe("report-uri /api/csp-report");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("allows eval only in development", () => {
    expect(directive(contentSecurityPolicy({ nonce: "abc", dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("keeps inline styles allowed without a nonce (a nonce would disable 'unsafe-inline')", () => {
    expect(directive(contentSecurityPolicy({ nonce: "abc", dev: false }), "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });
});

describe("strictTransportSecurity", () => {
  const base = { publicUrl: "https://files.example.com", host: "files.example.com", maxAgeSec: 31_536_000, includeSubDomains: false };

  it("is sent for the https PUBLIC_URL host", () => {
    expect(strictTransportSecurity(base)).toBe("max-age=31536000");
    expect(strictTransportSecurity({ ...base, includeSubDomains: true })).toBe("max-age=31536000; includeSubDomains");
    expect(strictTransportSecurity({ ...base, host: "Files.Example.com" })).toBe("max-age=31536000");
  });

  it("is not sent over plain http, on other hosts or when turned off", () => {
    expect(strictTransportSecurity({ ...base, publicUrl: "http://192.168.0.100" , host: "192.168.0.100" })).toBeNull();
    expect(strictTransportSecurity({ ...base, host: "192.168.0.100" })).toBeNull();
    expect(strictTransportSecurity({ ...base, host: null })).toBeNull();
    expect(strictTransportSecurity({ ...base, maxAgeSec: 0 })).toBeNull();
    expect(strictTransportSecurity({ ...base, publicUrl: "not a url" })).toBeNull();
  });
});

describe("parseCspReports", () => {
  it("reads legacy csp-report bodies without query strings", () => {
    const report = { "csp-report": { "document-uri": "https://files.example.com/s/abc?token=1", "violated-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?q=1" } };
    expect(parseCspReports(report)).toEqual([{ directive: "script-src-elem", blocked: "https://evil.example/x.js", page: "https://files.example.com/s/abc" }]);
  });

  it("reads Reporting API batches and skips other report types", () => {
    const batch = [
      { type: "csp-violation", body: { documentURL: "https://files.example.com/files", effectiveDirective: "script-src-elem", blockedURL: "inline" } },
      { type: "deprecation", body: { id: "x" } },
    ];
    expect(parseCspReports(batch)).toEqual([{ directive: "script-src-elem", blocked: "inline", page: "https://files.example.com/files" }]);
  });

  it("reduces blob and data URLs to their scheme and ignores junk", () => {
    expect(parseCspReports({ "csp-report": { "blocked-uri": "blob:https://files.example.com/123", "violated-directive": "img-src" } })[0]!.blocked).toBe("blob:");
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("x")).toEqual([]);
    expect(parseCspReports({ other: 1 })).toEqual([]);
  });
});
