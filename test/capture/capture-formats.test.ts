import { describe, it, expect } from "vitest";
import {
  validateCaptureFormats,
} from "../../src/capture/capture-formats.js";
import type { CaptureFormats } from "../../src/capture/capture-formats.js";

describe("validateCaptureFormats", () => {
  it("should return valid when all formats are enabled", () => {
    const formats: CaptureFormats = { png: true, webp: true, html: true, links: false, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only png is enabled", () => {
    const formats: CaptureFormats = { png: true, webp: false, html: false, links: false, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only webp is enabled", () => {
    const formats: CaptureFormats = { png: false, webp: true, html: false, links: false, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only html is enabled", () => {
    const formats: CaptureFormats = { png: false, webp: false, html: true, links: false, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when png and webp are enabled", () => {
    const formats: CaptureFormats = { png: true, webp: true, html: false, links: false, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only links is enabled", () => {
    const formats: CaptureFormats = { png: false, webp: false, html: false, links: true, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return valid when only mhtml is enabled", () => {
    const formats: CaptureFormats = { png: false, webp: false, html: false, links: false, mhtml: true, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(true);
  });

  it("should return invalid when all formats are disabled", () => {
    const formats: CaptureFormats = { png: false, webp: false, html: false, links: false, mhtml: false, wacz: false };
    const result = validateCaptureFormats(formats);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("At least one capture format must be enabled");
      expect(result.error).toContain("links");
      expect(result.error).toContain("mhtml");
    }
  });
});
