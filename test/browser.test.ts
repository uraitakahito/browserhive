import { describe, it, expect } from "vitest";
import { applyIpToWsUrl, resolveWsUrlHost } from "../src/browser.js";

interface ApplyCase {
  name: string;
  wsUrl: string;
  ip: string;
  port: number | undefined;
  family: 4 | 6;
  expected: string;
}

const applyCases: ApplyCase[] = [
  {
    name: "IPv4 with explicit port",
    wsUrl: "ws://localhost/devtools/browser/abc123",
    ip: "192.168.117.4",
    port: 9222,
    family: 4,
    expected: "ws://192.168.117.4:9222/devtools/browser/abc123",
  },
  {
    name: "IPv4 without explicit port (preserves URL's existing port)",
    wsUrl: "ws://localhost:9222/devtools/browser/abc123",
    ip: "192.168.117.4",
    port: undefined,
    family: 4,
    // URL.host = "192.168.117.4" keeps the original port.
    expected: "ws://192.168.117.4:9222/devtools/browser/abc123",
  },
  {
    name: "IPv6 wraps in brackets",
    wsUrl: "ws://localhost/devtools/browser/abc123",
    ip: "::1",
    port: 9222,
    family: 6,
    expected: "ws://[::1]:9222/devtools/browser/abc123",
  },
  {
    name: "IPv6 with full-form address",
    wsUrl: "ws://localhost/path",
    ip: "fd00:abcd::1",
    port: 9222,
    family: 6,
    expected: "ws://[fd00:abcd::1]:9222/path",
  },
  {
    name: "preserves multi-segment path",
    wsUrl: "ws://localhost:9222/devtools/browser/aaaa-bbbb-cccc/extra/path",
    ip: "10.0.0.1",
    port: 9222,
    family: 4,
    expected: "ws://10.0.0.1:9222/devtools/browser/aaaa-bbbb-cccc/extra/path",
  },
  {
    name: "preserves query string",
    wsUrl: "ws://localhost:9222/devtools/browser/uuid-1234?param=value",
    ip: "10.0.0.1",
    port: 9222,
    family: 4,
    expected: "ws://10.0.0.1:9222/devtools/browser/uuid-1234?param=value",
  },
  {
    name: "preserves wss scheme",
    wsUrl: "wss://localhost:9222/devtools/browser/abc",
    ip: "10.0.0.1",
    port: 9222,
    family: 4,
    expected: "wss://10.0.0.1:9222/devtools/browser/abc",
  },
  {
    name: "non-default port",
    wsUrl: "ws://localhost:9222/path",
    ip: "10.0.0.1",
    port: 3000,
    family: 4,
    expected: "ws://10.0.0.1:3000/path",
  },
];

describe("applyIpToWsUrl", () => {
  it.each(applyCases)("$name", ({ wsUrl, ip, port, family, expected }) => {
    expect(applyIpToWsUrl(wsUrl, ip, port, family)).toBe(expected);
  });
});

describe("resolveWsUrlHost", () => {
  it("resolves localhost to a loopback IP literal", async () => {
    // OS resolver-dependent: macOS / Linux Docker both resolve `localhost`
    // to either 127.0.0.1 (family 4) or ::1 (family 6). Accept either.
    const out = await resolveWsUrlHost(
      "ws://localhost/devtools/browser/abc",
      "localhost:9222",
    );
    expect(out).toMatch(
      /^ws:\/\/(127\.0\.0\.1|\[::1\]):9222\/devtools\/browser\/abc$/,
    );
  });

  it("resolves an IP literal back to the same IP literal", async () => {
    // dns.lookup("192.168.1.1") returns { address: "192.168.1.1", family: 4 }.
    // This guarantees no behaviour change for callers already passing IPs.
    const out = await resolveWsUrlHost(
      "ws://localhost/devtools/browser/abc",
      "192.168.1.1:9222",
    );
    expect(out).toBe("ws://192.168.1.1:9222/devtools/browser/abc");
  });

  it("preserves URL's existing port when targetHost has no port", async () => {
    const out = await resolveWsUrlHost(
      "ws://localhost:9222/devtools/browser/abc",
      "localhost",
    );
    expect(out).toMatch(
      /^ws:\/\/(127\.0\.0\.1|\[::1\]):9222\/devtools\/browser\/abc$/,
    );
  });

  it("propagates DNS resolution failures", async () => {
    await expect(
      resolveWsUrlHost(
        "ws://localhost/devtools/browser/abc",
        "this-host-definitely-does-not-exist-xyz123.invalid:9222",
      ),
    ).rejects.toThrow(/ENOTFOUND|EAI_AGAIN|getaddrinfo/);
  });

  it("rejects empty hostname", async () => {
    await expect(
      resolveWsUrlHost("ws://localhost/devtools/browser/abc", ":9222"),
    ).rejects.toThrow(/empty hostname/);
  });
});
