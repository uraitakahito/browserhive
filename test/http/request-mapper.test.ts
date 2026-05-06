import { describe, it, expect } from "vitest";
import {
  captureRequestToTask as captureRequestToTaskRaw,
  type RequestMapperDefaults,
} from "../../src/http/request-mapper.js";
import type { CaptureRequest } from "../../src/http/generated/index.js";
import type { CaptureTask } from "../../src/capture/types.js";
import {
  CUSTOM_FRAMEWORK_LABEL,
  DEFAULT_DISMISS_OPTIONS,
  KNOWN_CMP_ENTRIES,
} from "../../src/capture/banner-dismisser.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";
import type { Result } from "../../src/result.js";

const baseRequest = (overrides: Partial<CaptureRequest> = {}): CaptureRequest => ({
  url: "https://example.com",
  labels: [],
  captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false, mhtml: false },
  ...overrides,
});

/**
 * Default server-side mapper defaults used by every test that does not
 * specifically exercise resetState resolution. Exposed as a thin wrapper
 * around `captureRequestToTaskRaw` so most tests do not have to repeat
 * the second argument; tests that DO exercise resetState resolution call
 * the raw function directly.
 */
const baseDefaults: RequestMapperDefaults = {
  resetPageState: DEFAULT_RESET_STATE_OPTIONS,
};

const captureRequestToTask = (
  request: CaptureRequest,
  defaults: RequestMapperDefaults = baseDefaults,
): Result<CaptureTask, string> => captureRequestToTaskRaw(request, defaults);

describe("captureRequestToTask", () => {
  it("rejects an empty url", () => {
    const result = captureRequestToTask(baseRequest({ url: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("url is required");
  });

  it("requires at least one capture format", () => {
    const result = captureRequestToTask(
      baseRequest({ captureFormats: { png: false, jpeg: false, html: false, links: false, pdf: false, mhtml: false } }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid label characters", () => {
    const result = captureRequestToTask(baseRequest({ labels: ["bad/label"] }));
    expect(result.ok).toBe(false);
  });

  it("rejects invalid correlationId", () => {
    const result = captureRequestToTask(
      baseRequest({ correlationId: "with spaces" }),
    );
    expect(result.ok).toBe(false);
  });

  it("trims labels and produces a CaptureTask with a UUID", () => {
    const result = captureRequestToTask(
      baseRequest({ labels: ["  foo  ", "", "bar"], correlationId: "EXT-1" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.labels).toEqual(["foo", "bar"]);
    expect(result.value.correlationId).toBe("EXT-1");
    expect(result.value.taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.value.retryCount).toBe(0);
    expect(result.value.dismissOptions).toBeUndefined();
  });

  it("stamps enqueuedAt with a current ISO 8601 timestamp", () => {
    const before = Date.now();
    const result = captureRequestToTask(baseRequest());
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enqueuedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    const t = new Date(result.value.enqueuedAt).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("omits correlationId when not provided", () => {
    const result = captureRequestToTask(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.correlationId).toBeUndefined();
  });

  it("propagates acceptLanguage to the CaptureTask", () => {
    const result = captureRequestToTask(
      baseRequest({ acceptLanguage: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptLanguage).toBe(
      "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    );
  });

  it("trims surrounding whitespace from acceptLanguage", () => {
    const result = captureRequestToTask(
      baseRequest({ acceptLanguage: "  en-US  " }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptLanguage).toBe("en-US");
  });

  it("omits acceptLanguage when not provided", () => {
    const result = captureRequestToTask(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptLanguage).toBeUndefined();
  });

  it("omits acceptLanguage when only whitespace", () => {
    const result = captureRequestToTask(
      baseRequest({ acceptLanguage: "   " }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptLanguage).toBeUndefined();
  });

  describe("dismissBanners → dismissOptions", () => {
    it("leaves dismissOptions undefined when omitted", () => {
      const result = captureRequestToTask(baseRequest());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dismissOptions).toBeUndefined();
    });

    it("leaves dismissOptions undefined when false", () => {
      const result = captureRequestToTask(baseRequest({ dismissBanners: false }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dismissOptions).toBeUndefined();
    });

    it("resolves true to DEFAULT_DISMISS_OPTIONS", () => {
      const result = captureRequestToTask(baseRequest({ dismissBanners: true }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dismissOptions).toBe(DEFAULT_DISMISS_OPTIONS);
    });

    it("merges extraSelectors as custom-framework entries on top of defaults", () => {
      const result = captureRequestToTask(
        baseRequest({
          dismissBanners: { extraSelectors: ["#paywall", ".takeover"] },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const opts = result.value.dismissOptions;
      expect(opts).toBeDefined();
      // Defaults preserved...
      expect(opts?.knownCmpEntries.length).toBe(KNOWN_CMP_ENTRIES.length + 2);
      // ...and the two custom selectors appear at the tail tagged "custom".
      const tail = opts?.knownCmpEntries.slice(-2) ?? [];
      expect(tail).toEqual([
        { framework: CUSTOM_FRAMEWORK_LABEL, selector: "#paywall" },
        { framework: CUSTOM_FRAMEWORK_LABEL, selector: ".takeover" },
      ]);
    });

    it("excludeFrameworks removes a curated framework while keeping the rest", () => {
      const result = captureRequestToTask(
        baseRequest({ dismissBanners: { excludeFrameworks: ["TrustArc"] } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const opts = result.value.dismissOptions;
      expect(opts).toBeDefined();
      expect(
        opts?.knownCmpEntries.some((e) => e.framework === "TrustArc"),
      ).toBe(false);
      expect(
        opts?.knownCmpEntries.some((e) => e.framework === "OneTrust"),
      ).toBe(true);
    });

    it("useDefaults: false drops the curated list, keeping only extraSelectors", () => {
      const result = captureRequestToTask(
        baseRequest({
          dismissBanners: { useDefaults: false, extraSelectors: ["#only"] },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const opts = result.value.dismissOptions;
      expect(opts?.knownCmpEntries).toEqual([
        { framework: CUSTOM_FRAMEWORK_LABEL, selector: "#only" },
      ]);
    });

    it("heuristic.enabled: false propagates while leaving thresholds at defaults", () => {
      const result = captureRequestToTask(
        baseRequest({ dismissBanners: { heuristic: { enabled: false } } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const heuristic = result.value.dismissOptions?.heuristic;
      expect(heuristic?.enabled).toBe(false);
      expect(heuristic?.minViewportCoverageRatio).toBe(0.3);
      expect(heuristic?.minZIndex).toBe(1000);
    });

    it("heuristic numeric overrides flow through field-by-field", () => {
      const result = captureRequestToTask(
        baseRequest({
          dismissBanners: {
            heuristic: { minViewportCoverageRatio: 0.1, minZIndex: 50 },
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const heuristic = result.value.dismissOptions?.heuristic;
      expect(heuristic?.enabled).toBe(true);
      expect(heuristic?.minViewportCoverageRatio).toBe(0.1);
      expect(heuristic?.minZIndex).toBe(50);
    });

    it("failOnError defaults to false on an empty / boolean spec", () => {
      const empty = captureRequestToTask(baseRequest({ dismissBanners: {} }));
      expect(empty.ok).toBe(true);
      if (!empty.ok) return;
      expect(empty.value.dismissOptions?.failOnError).toBe(false);

      const boolTrue = captureRequestToTask(
        baseRequest({ dismissBanners: true }),
      );
      expect(boolTrue.ok).toBe(true);
      if (!boolTrue.ok) return;
      expect(boolTrue.value.dismissOptions?.failOnError).toBe(false);
    });

    it("failOnError: true propagates into the resolved DismissOptions", () => {
      const result = captureRequestToTask(
        baseRequest({ dismissBanners: { failOnError: true } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dismissOptions?.failOnError).toBe(true);
    });
  });

  describe("viewport / fullPage", () => {
    it("propagates viewport to the CaptureTask when provided", () => {
      const result = captureRequestToTask(
        baseRequest({ viewport: { width: 1920, height: 1080 } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.viewport).toEqual({ width: 1920, height: 1080 });
    });

    it("omits viewport when not provided", () => {
      const result = captureRequestToTask(baseRequest());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.viewport).toBeUndefined();
    });

    it("propagates fullPage: true to the CaptureTask", () => {
      const result = captureRequestToTask(baseRequest({ fullPage: true }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fullPage).toBe(true);
    });

    it("propagates fullPage: false to the CaptureTask", () => {
      const result = captureRequestToTask(baseRequest({ fullPage: false }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fullPage).toBe(false);
    });

    it("omits fullPage when not provided", () => {
      const result = captureRequestToTask(baseRequest());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fullPage).toBeUndefined();
    });
  });

  describe("resetState → CaptureTask.resetState", () => {
    /** Server defaults that flip pageContext off, used to assert per-axis fallback. */
    const defaultsKeepContext: RequestMapperDefaults = {
      resetPageState: { cookies: true, pageContext: false },
    };

    it("resolves to server defaults when the request omits resetState", () => {
      const result = captureRequestToTask(baseRequest());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resetState).toEqual(DEFAULT_RESET_STATE_OPTIONS);
    });

    it("forces both axes true on resetState: true (overriding server defaults)", () => {
      const result = captureRequestToTask(
        baseRequest({ resetState: true }),
        // Server says "skip everything" — request `true` still wipes both.
        { resetPageState: { cookies: false, pageContext: false } },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resetState).toEqual({ cookies: true, pageContext: true });
    });

    it("forces both axes false on resetState: false (overriding server defaults)", () => {
      const result = captureRequestToTask(baseRequest({ resetState: false }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resetState).toEqual({
        cookies: false,
        pageContext: false,
      });
    });

    it("merges per-axis spec with server defaults (only specified field changes)", () => {
      // Server keeps cookies on, pageContext off. Request flips cookies off
      // but says nothing about pageContext → server's `false` carries through.
      const result = captureRequestToTaskRaw(
        baseRequest({ resetState: { cookies: false } }),
        defaultsKeepContext,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resetState).toEqual({
        cookies: false,
        pageContext: false,
      });
    });

    it("uses spec values verbatim when both fields are supplied", () => {
      const result = captureRequestToTask(
        baseRequest({
          resetState: { cookies: true, pageContext: false },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resetState).toEqual({
        cookies: true,
        pageContext: false,
      });
    });

    it("treats an empty resetState object as 'use server defaults verbatim'", () => {
      const result = captureRequestToTaskRaw(
        baseRequest({ resetState: {} }),
        defaultsKeepContext,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resetState).toEqual(defaultsKeepContext.resetPageState);
    });
  });
});
