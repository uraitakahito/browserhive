import { describe, it, expect } from "vitest";
import { captureRequestToTask } from "../../src/grpc/request-mapper.js";
import type { CaptureRequest } from "../../src/grpc/generated/browserhive/v1/capture.js";

const createRequest = (overrides: Partial<CaptureRequest> = {}): CaptureRequest => ({
  url: "https://example.com",
  labels: ["Test"],
  capture_options: { png: true, jpeg: false, html: true },
  ...overrides,
});

describe("captureRequestToTask", () => {
  describe("successful conversion", () => {
    it("should return success with valid request", () => {
      const request = createRequest();
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.taskId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.value.url).toBe("https://example.com");
        expect(result.value.labels).toEqual(["Test"]);
        expect(result.value.retryCount).toBe(0);
        expect(result.value.captureOptions).toEqual({ png: true, jpeg: false, html: true });
      }
    });

    it("should trim url", () => {
      const request = createRequest({ url: "  https://example.com  " });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe("https://example.com");
      }
    });

    it("should trim and filter labels", () => {
      const request = createRequest({ labels: ["  TestName  ", "  Category  "] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.labels).toEqual(["TestName", "Category"]);
      }
    });

    it("should filter out whitespace-only labels", () => {
      const request = createRequest({ labels: ["   "] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.labels).toEqual([]);
      }
    });

    it("should accept empty labels array", () => {
      const request = createRequest({ labels: [] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.labels).toEqual([]);
      }
    });

    it("should include correlationId when provided", () => {
      const request = createRequest({ correlation_id: "ext-123" });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.correlationId).toBe("ext-123");
      }
    });

    it("should not include correlationId when not provided", () => {
      const request = createRequest({ correlation_id: undefined });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toHaveProperty("correlationId");
      }
    });

    it("should generate unique taskIds", () => {
      const request = createRequest();
      const result1 = captureRequestToTask(request);
      const result2 = captureRequestToTask(request);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.taskId).not.toBe(result2.value.taskId);
      }
    });

    it("should accept multiple valid labels", () => {
      const request = createRequest({ labels: ["cat", "subcat", "tag"] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.labels).toEqual(["cat", "subcat", "tag"]);
      }
    });
  });

  describe("validation errors", () => {
    it("should reject when url is empty", () => {
      const request = createRequest({ url: "" });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("url is required");
      }
    });

    it("should reject when url is whitespace only", () => {
      const request = createRequest({ url: "   " });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("url is required");
      }
    });

    it("should reject when capture_options is undefined", () => {
      const request = createRequest({ capture_options: undefined });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("At least one capture option must be enabled");
      }
    });

    it("should reject when all capture_options flags are false", () => {
      const request = createRequest({
        capture_options: { png: false, jpeg: false, html: false },
      });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("At least one capture option must be enabled");
      }
    });

    it("should reject when any label contains invalid characters", () => {
      const request = createRequest({ labels: ["Valid", "Test:Name"] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid filename");
      }
    });

    it("should reject when any label contains whitespace", () => {
      const request = createRequest({ labels: ["Valid", "Test Name"] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("whitespace");
      }
    });

    it("should reject when any label exceeds 100 characters", () => {
      const request = createRequest({ labels: ["Valid", "a".repeat(101)] });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("exceeds");
      }
    });

    it("should reject when correlation_id contains invalid characters", () => {
      const request = createRequest({ correlation_id: "ext/id" });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid filename");
      }
    });
  });

  describe("captureOptions conversion from Proto", () => {
    it("should convert png-only proto options", () => {
      const request = createRequest({
        capture_options: { png: true, jpeg: false, html: false },
      });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.captureOptions).toEqual({ png: true, jpeg: false, html: false });
      }
    });

    it("should convert jpeg-only proto options", () => {
      const request = createRequest({
        capture_options: { png: false, jpeg: true, html: false },
      });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.captureOptions).toEqual({ png: false, jpeg: true, html: false });
      }
    });

    it("should convert html-only proto options", () => {
      const request = createRequest({
        capture_options: { png: false, jpeg: false, html: true },
      });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.captureOptions).toEqual({ png: false, jpeg: false, html: true });
      }
    });

    it("should convert all enabled proto options", () => {
      const request = createRequest({
        capture_options: { png: true, jpeg: true, html: true },
      });
      const result = captureRequestToTask(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.captureOptions).toEqual({ png: true, jpeg: true, html: true });
      }
    });
  });
});
