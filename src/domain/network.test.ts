import { describe, expect, it } from "vitest";
import { clientIp, ipInCidrs, isPrivateIp, maskIp, rateLimitSubject } from "./network";

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

describe("rateLimitSubject", () => {
  it("keys IPv6 addresses on their /64", () => {
    expect(rateLimitSubject("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("2001:0DB8:0001:0002:0:0:0:9")).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitSubject("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitSubject("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitSubject("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
  });

  it("keeps IPv4 addresses whole, also when IPv4-mapped", () => {
    expect(rateLimitSubject("211.36.12.7")).toBe("211.36.12.7");
    expect(rateLimitSubject("::ffff:211.36.12.7")).toBe("211.36.12.7");
    expect(rateLimitSubject("")).toBe("");
  });

  it("leaves text that is not an address as it is", () => {
    expect(rateLimitSubject("1:2:3")).toBe("1:2:3");
    expect(rateLimitSubject("1::2::3")).toBe("1::2::3");
    expect(rateLimitSubject("zz::1")).toBe("zz::1");
  });
});
