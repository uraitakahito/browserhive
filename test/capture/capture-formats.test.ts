import { describe, it, expect } from "vitest";
import {
  validateCaptureFormats,
} from "../../src/capture/capture-formats.js";
import type { CaptureFormats } from "../../src/capture/capture-formats.js";

describe("validateCaptureFormats", () => {
  it("should return valid when all formats are enabled", () => {
    const formats: CaptureFormats = { png: true, jpeg: true, html: true };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only png is enabled", () => {
    const formats: CaptureFormats = { png: true, jpeg: false, html: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only jpeg is enabled", () => {
    const formats: CaptureFormats = { png: false, jpeg: true, html: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only html is enabled", () => {
    const formats: CaptureFormats = { png: false, jpeg: false, html: true };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when png and jpeg are enabled", () => {
    const formats: CaptureFormats = { png: true, jpeg: true, html: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return invalid when all formats are disabled", () => {
    const formats: CaptureFormats = { png: false, jpeg: false, html: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("At least one capture format must be enabled");
    }
  });
});
