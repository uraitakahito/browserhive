import { describe, it, expect } from "vitest";
import {
  errorDetailsFromException,
  extractPuppeteerTimeoutMs,
  PuppeteerTimeoutError,
  TimeoutError,
} from "../../src/capture/error-details.js";

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

describe("errorDetailsFromException", () => {
  it("classifies our own TimeoutError as `timeout` with typed timeoutMs", () => {
    const err = new TimeoutError({ operation: "Navigation", timeoutMs: 30000 });
    const details = errorDetailsFromException(err);

    expect(details.type).toBe("timeout");
    expect(details.timeoutMs).toBe(30000);
    expect(details.message).toBe("Timeout: Navigation (30000ms)");
  });

  it("classifies puppeteer.TimeoutError as `timeout` with parsed timeoutMs", () => {
    // This is the exact message format puppeteer's LifecycleWatcher emits.
    // Pre-refactor it was misclassified as `internal` because the
    // message-string check was case-sensitive (`includes("Timeout")` vs
    // lowercase `timeout` in puppeteer's text).
    const err = new PuppeteerTimeoutError("Navigation timeout of 30000 ms exceeded");
    const details = errorDetailsFromException(err);

    expect(details.type).toBe("timeout");
    expect(details.timeoutMs).toBe(30000);
    expect(details.message).toBe("Navigation timeout of 30000 ms exceeded");
  });

  it("leaves timeoutMs unset when puppeteer's message is unparseable", () => {
    // Hypothetical puppeteer error whose message does not match the
    // ms-exceeded tail. Type still classifies as timeout, but timeoutMs
    // is intentionally absent rather than fabricated.
    const err = new PuppeteerTimeoutError("Something timed out, no ms reported");
    const details = errorDetailsFromException(err);

    expect(details.type).toBe("timeout");
    expect(details.timeoutMs).toBeUndefined();
  });

  it("classifies connection-closed errors as `connection`", () => {
    expect(errorDetailsFromException(new Error("Connection closed")).type).toBe(
      "connection",
    );
    expect(
      errorDetailsFromException(new Error("Browser was disconnected")).type,
    ).toBe("connection");
  });

  it("classifies anything unknown as `internal`", () => {
    expect(errorDetailsFromException(new Error("net::ERR_FOOBAR")).type).toBe(
      "internal",
    );
    expect(
      errorDetailsFromException(new Error("Execution context was destroyed")).type,
    ).toBe("internal");
  });

  it("handles non-Error throws by stringifying", () => {
    const details = errorDetailsFromException("plain string");
    expect(details.type).toBe("internal");
    expect(details.message).toBe("plain string");
  });
});
