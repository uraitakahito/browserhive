import { describe, it, expect } from "vitest";
import {
  validateCaptureOptions,
} from "../../src/capture/capture-mode.js";
import type { CaptureOptions } from "../../src/capture/capture-mode.js";

describe("validateCaptureOptions", () => {
  it("should return valid when all options are enabled", () => {
    const options: CaptureOptions = { png: true, jpeg: true, html: true };
    const result = validateCaptureOptions(options);
    expect(result.valid).toBe(true);
  });

  it("should return valid when only png is enabled", () => {
    const options: CaptureOptions = { png: true, jpeg: false, html: false };
    const result = validateCaptureOptions(options);
    expect(result.valid).toBe(true);
  });

  it("should return valid when only jpeg is enabled", () => {
    const options: CaptureOptions = { png: false, jpeg: true, html: false };
    const result = validateCaptureOptions(options);
    expect(result.valid).toBe(true);
  });

  it("should return valid when only html is enabled", () => {
    const options: CaptureOptions = { png: false, jpeg: false, html: true };
    const result = validateCaptureOptions(options);
    expect(result.valid).toBe(true);
  });

  it("should return valid when png and jpeg are enabled", () => {
    const options: CaptureOptions = { png: true, jpeg: true, html: false };
    const result = validateCaptureOptions(options);
    expect(result.valid).toBe(true);
  });

  it("should return invalid when all options are disabled", () => {
    const options: CaptureOptions = { png: false, jpeg: false, html: false };
    const result = validateCaptureOptions(options);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("At least one capture option must be enabled");
    }
  });
});
