import { describe, it, expect } from "vitest";
import { extractPuppeteerTimeoutMs } from "../../src/capture/error-details.js";

describe("extractPuppeteerTimeoutMs", () => {
  it("parses Puppeteer's Navigation timeout message (space before ms)", () => {
    expect(
      extractPuppeteerTimeoutMs("Navigation timeout of 30000 ms exceeded"),
    ).toBe(30000);
  });

  it("parses Puppeteer's WaitTask message (no space before ms)", () => {
    expect(extractPuppeteerTimeoutMs("Waiting failed: 100ms exceeded")).toBe(100);
  });

  it("parses Puppeteer's element-wait message (no space, embedded label)", () => {
    expect(
      extractPuppeteerTimeoutMs("Waiting for `FileChooser` failed: 5000ms exceeded"),
    ).toBe(5000);
  });

  it("returns undefined when the message does not match", () => {
    expect(extractPuppeteerTimeoutMs("Execution context was destroyed")).toBeUndefined();
    expect(extractPuppeteerTimeoutMs("net::ERR_HTTP2_PROTOCOL_ERROR")).toBeUndefined();
    expect(extractPuppeteerTimeoutMs("")).toBeUndefined();
  });

  it("returns undefined when 'exceeded' is missing (avoids false positives)", () => {
    expect(extractPuppeteerTimeoutMs("Took 30000 ms to complete")).toBeUndefined();
  });
});
