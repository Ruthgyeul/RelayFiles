import { describe, expect, it } from "vitest";
import { clientIp, ipInCidrs, isPrivateIp, maskIp } from "./network";

describe("maskIp", () => {
  it("hides the last two IPv4 octets and most of IPv6", () => {
    expect(maskIp("211.36.12.7")).toBe("211.36.•••.•••");
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:•••");
    expect(maskIp("unknown")).toBe("•••");
  });
});

describe("isPrivateIp", () => {
  it("detects LAN and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.100", "172.16.0.1", "172.31.255.1", "::1", "fd12:3456::1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["172.32.0.1", "8.8.8.8", "211.36.12.7", "2001:db8::1"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("ipInCidrs", () => {
  it("matches IPv4 ranges", () => {
    expect(ipInCidrs("192.168.0.42", ["192.168.0.0/24"])).toBe(true);
    expect(ipInCidrs("192.168.1.42", ["192.168.0.0/24"])).toBe(false);
    expect(ipInCidrs("10.9.8.7", ["192.168.0.0/24", "10.0.0.0/8"])).toBe(true);
    expect(ipInCidrs("::ffff:192.168.0.5", ["192.168.0.0/24"])).toBe(true);
    expect(ipInCidrs("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
    expect(ipInCidrs("1.2.3.4", ["1.2.3.4/32"])).toBe(true);
  });

  it("rejects malformed input and IPv6", () => {
    expect(ipInCidrs("", ["0.0.0.0/0"])).toBe(false);
    expect(ipInCidrs("2001:db8::1", ["0.0.0.0/0"])).toBe(false);
    expect(ipInCidrs("256.1.1.1", ["0.0.0.0/0"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", ["bad"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", [])).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers Cloudflare, then Nginx, and is empty without a proxy", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": " 10.0.0.1 " }))).toBe("10.0.0.1");
    expect(clientIp(new Headers())).toBe("");
  });
});
