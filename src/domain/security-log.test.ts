import { describe, expect, it } from "vitest";
import { SECURITY_EVENTS, isSecurityEvent, isSecurityWarning, revokedTokensDetail, securityEventLabel, securityEventOrigin, signedOutDetail } from "./security-log";

describe("security log vocabulary", () => {
  it("labels every event", () => {
    for (const kind of SECURITY_EVENTS) expect(securityEventLabel(kind)).not.toBe("");
  });

  it("recognizes known events only", () => {
    expect(isSecurityEvent("signin")).toBe(true);
    expect(isSecurityEvent("token.reveal")).toBe(false);
  });

  it("marks failed token entries as warnings", () => {
    expect(isSecurityWarning("reauth.failed")).toBe(true);
    expect(isSecurityWarning("apiToken.rejected")).toBe(true);
    expect(isSecurityWarning("signin")).toBe(false);
  });
});

describe("securityEventOrigin", () => {
  it("joins the known parts", () => {
    expect(securityEventOrigin({ os: "macOS", browser: "Safari", country: "KR", ipMasked: "203.0.x.x" })).toBe("macOS · Safari · KR · 203.0.x.x");
  });

  it("leaves out an unknown country", () => {
    expect(securityEventOrigin({ os: "Linux", browser: "curl", country: null, ipMasked: "10.0.x.x" })).toBe("Linux · curl · 10.0.x.x");
  });
});

describe("details", () => {
  it("counts revoked API tokens", () => {
    expect(revokedTokensDetail(0)).toBeUndefined();
    expect(revokedTokensDetail(1)).toBe("1 API token revoked");
    expect(revokedTokensDetail(3)).toBe("3 API tokens revoked");
  });

  it("counts signed-out devices", () => {
    expect(signedOutDetail(1)).toBe("1 device");
    expect(signedOutDetail(2)).toBe("2 devices");
  });
});
