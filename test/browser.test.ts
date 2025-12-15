import { describe, it, expect } from "vitest";
import { replaceWsUrlHost } from "../src/browser.js";

describe("replaceWsUrlHost", () => {
  it("should replace localhost with target host", () => {
    const wsUrl = "ws://localhost/devtools/browser/abc123";
    const targetHost = "chromium:9222";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("ws://chromium:9222/devtools/browser/abc123");
  });

  it("should replace localhost:port with target host", () => {
    const wsUrl = "ws://localhost:9222/devtools/browser/abc123";
    const targetHost = "puppeteer:9222";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("ws://puppeteer:9222/devtools/browser/abc123");
  });

  it("should preserve path and query parameters", () => {
    const wsUrl = "ws://localhost:9222/devtools/browser/uuid-1234?param=value";
    const targetHost = "browser-host:9222";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("ws://browser-host:9222/devtools/browser/uuid-1234?param=value");
  });

  it("should handle different port numbers", () => {
    const wsUrl = "ws://localhost:9222/path";
    const targetHost = "browser:3000";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("ws://browser:3000/path");
  });

  it("should handle IP address as target host", () => {
    const wsUrl = "ws://localhost/devtools/browser/123";
    const targetHost = "192.168.1.100:9222";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("ws://192.168.1.100:9222/devtools/browser/123");
  });

  it("should handle wss protocol", () => {
    const wsUrl = "wss://localhost:9222/devtools/browser/abc";
    const targetHost = "secure-browser:9222";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("wss://secure-browser:9222/devtools/browser/abc");
  });

  it("should handle target host without port (keeps original port)", () => {
    // Note: When setting host without port, the URL API keeps the original port
    const wsUrl = "ws://localhost:9222/devtools";
    const targetHost = "browser-only-host";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    // The host property includes port, so setting just hostname keeps the port
    expect(result).toBe("ws://browser-only-host:9222/devtools");
  });

  it("should handle complex paths", () => {
    const wsUrl = "ws://localhost:9222/devtools/browser/aaaa-bbbb-cccc-dddd/extra/path";
    const targetHost = "chromium-server:9222";

    const result = replaceWsUrlHost(wsUrl, targetHost);

    expect(result).toBe("ws://chromium-server:9222/devtools/browser/aaaa-bbbb-cccc-dddd/extra/path");
  });
});
