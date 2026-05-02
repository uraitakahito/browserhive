import { describe, it, expect } from "vitest";
import { captureRequestToTask } from "../../src/http/request-mapper.js";
import type { components } from "../../src/http/generated/types.js";

type CaptureRequest = components["schemas"]["CaptureRequest"];

const baseRequest = (overrides: Partial<CaptureRequest> = {}): CaptureRequest => ({
  url: "https://example.com",
  labels: [],
  captureOptions: { png: true, jpeg: false, html: false },
  dismissBanners: false,
  ...overrides,
});

describe("captureRequestToTask", () => {
  it("rejects an empty url", () => {
    const result = captureRequestToTask(baseRequest({ url: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("url is required");
  });

  it("requires at least one capture option", () => {
    const result = captureRequestToTask(
      baseRequest({ captureOptions: { png: false, jpeg: false, html: false } }),
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
    expect(result.value.dismissBanners).toBe(false);
  });

  it("omits correlationId when not provided", () => {
    const result = captureRequestToTask(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.correlationId).toBeUndefined();
  });
});
