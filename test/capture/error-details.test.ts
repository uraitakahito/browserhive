import { describe, it, expect } from "vitest";
import {
  errorDetailsFromException,
  extractPuppeteerTimeoutMs,
  isExecutionContextDestroyed,
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

  it("classifies puppeteer's TimeoutError loaded under a different module identity (dual-package hazard)", () => {
    // Reproduce the production scenario: `puppeteer-extra` (CJS) loads
    // its own copy of `puppeteer-core/.../Errors.js` distinct from the
    // ESM copy our `PuppeteerTimeoutError` import resolves to. The two
    // classes share source and shape but `instanceof` won't bridge them.
    // Hand-build a class with the same name + parent shape.
    class PuppeteerError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "PuppeteerError";
      }
    }
    class TimeoutErrorViaCjs extends PuppeteerError {
      constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
      }
    }
    const err = new TimeoutErrorViaCjs("Navigation timeout of 30000 ms exceeded");

    // Sanity: instanceof against our ESM-side import does NOT match.
    expect(err instanceof PuppeteerTimeoutError).toBe(false);

    const details = errorDetailsFromException(err);
    expect(details.type).toBe("timeout");
    expect(details.timeoutMs).toBe(30000);
  });

  it("does not false-positive on a foreign class merely named TimeoutError", () => {
    // A class called TimeoutError without the PuppeteerError parent
    // (e.g. some unrelated library's own timeout). Should fall through
    // to internal, not be misclassified as a puppeteer timeout.
    class UnrelatedTimeoutError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
      }
    }
    const err = new UnrelatedTimeoutError("Unrelated 1000 ms exceeded");
    const details = errorDetailsFromException(err);
    expect(details.type).toBe("internal");
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

describe("isExecutionContextDestroyed", () => {
  // The exact wording puppeteer emits on a JS-redirect mid-evaluate. Seen
  // in production traffic from data/js-redirect.yaml (e.g. imhds.co.jp,
  // itochu.co.jp, daiwahouse.com). The test cases below pin the contract
  // that runOnStableContext relies on.
  const CANONICAL_MESSAGE =
    "Execution context was destroyed, most likely because of a navigation.";

  it("returns true on puppeteer's canonical destroyed-context message", () => {
    expect(isExecutionContextDestroyed(new Error(CANONICAL_MESSAGE))).toBe(true);
  });

  it("returns true on a partial substring match (puppeteer minor versions add wording)", () => {
    expect(
      isExecutionContextDestroyed(new Error("Execution context was destroyed")),
    ).toBe(true);
    expect(
      isExecutionContextDestroyed(
        new Error("Protocol error: Execution context was destroyed unexpectedly"),
      ),
    ).toBe(true);
  });

  it("returns true case-insensitively (defends against logging/transport casing changes)", () => {
    expect(
      isExecutionContextDestroyed(new Error("EXECUTION CONTEXT WAS DESTROYED")),
    ).toBe(true);
  });

  it("returns false on unrelated errors", () => {
    expect(isExecutionContextDestroyed(new Error("Navigation timeout"))).toBe(false);
    expect(isExecutionContextDestroyed(new Error("net::ERR_NAME_NOT_RESOLVED"))).toBe(
      false,
    );
    expect(isExecutionContextDestroyed(new Error("HTTP 404"))).toBe(false);
  });

  it("returns false on non-Error rejections (string / undefined / null / object)", () => {
    expect(isExecutionContextDestroyed("Execution context was destroyed")).toBe(false);
    expect(isExecutionContextDestroyed(undefined)).toBe(false);
    expect(isExecutionContextDestroyed(null)).toBe(false);
    expect(
      isExecutionContextDestroyed({ message: "Execution context was destroyed" }),
    ).toBe(false);
  });
});
