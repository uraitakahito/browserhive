import { describe, it, expect } from "vitest";
import {
  validateCaptureOptions,
  captureOptionsFromProto,
  captureOptionsToProto,
} from "../../src/capture/capture-mode.js";
import type { CaptureOptions } from "../../src/capture/capture-mode.js";
import { CaptureOptions as ProtoCaptureOptions } from "../../src/grpc/generated/browserhive/v1/capture.js";

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

describe("captureOptionsFromProto", () => {
  it("should return all false when proto is undefined", () => {
    const result = captureOptionsFromProto(undefined);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(false);
  });

  it("should return all false when all proto flags are false", () => {
    const proto: ProtoCaptureOptions = { png: false, jpeg: false, html: false };
    const result = captureOptionsFromProto(proto);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(false);
  });

  it("should convert png-only proto options", () => {
    const proto: ProtoCaptureOptions = { png: true, jpeg: false, html: false };
    const result = captureOptionsFromProto(proto);
    expect(result.png).toBe(true);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(false);
  });

  it("should convert jpeg-only proto options", () => {
    const proto: ProtoCaptureOptions = { png: false, jpeg: true, html: false };
    const result = captureOptionsFromProto(proto);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(true);
    expect(result.html).toBe(false);
  });

  it("should convert html-only proto options", () => {
    const proto: ProtoCaptureOptions = { png: false, jpeg: false, html: true };
    const result = captureOptionsFromProto(proto);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(true);
  });

  it("should convert all enabled proto options", () => {
    const proto: ProtoCaptureOptions = { png: true, jpeg: true, html: true };
    const result = captureOptionsFromProto(proto);
    expect(result.png).toBe(true);
    expect(result.jpeg).toBe(true);
    expect(result.html).toBe(true);
  });
});

describe("captureOptionsToProto", () => {
  it("should convert png-only options", () => {
    const options: CaptureOptions = { png: true, jpeg: false, html: false };
    const result = captureOptionsToProto(options);
    expect(result.png).toBe(true);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(false);
  });

  it("should convert jpeg-only options", () => {
    const options: CaptureOptions = { png: false, jpeg: true, html: false };
    const result = captureOptionsToProto(options);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(true);
    expect(result.html).toBe(false);
  });

  it("should convert html-only options", () => {
    const options: CaptureOptions = { png: false, jpeg: false, html: true };
    const result = captureOptionsToProto(options);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(true);
  });

  it("should convert all enabled options", () => {
    const options: CaptureOptions = { png: true, jpeg: true, html: true };
    const result = captureOptionsToProto(options);
    expect(result.png).toBe(true);
    expect(result.jpeg).toBe(true);
    expect(result.html).toBe(true);
  });

  it("should convert all disabled options", () => {
    const options: CaptureOptions = { png: false, jpeg: false, html: false };
    const result = captureOptionsToProto(options);
    expect(result.png).toBe(false);
    expect(result.jpeg).toBe(false);
    expect(result.html).toBe(false);
  });
});

describe("roundtrip conversion", () => {
  it("should preserve png-only options through roundtrip", () => {
    const original: CaptureOptions = { png: true, jpeg: false, html: false };
    const proto = captureOptionsToProto(original);
    const result = captureOptionsFromProto(proto);
    expect(result).toEqual(original);
  });

  it("should preserve jpeg-only options through roundtrip", () => {
    const original: CaptureOptions = { png: false, jpeg: true, html: false };
    const proto = captureOptionsToProto(original);
    const result = captureOptionsFromProto(proto);
    expect(result).toEqual(original);
  });

  it("should preserve html-only options through roundtrip", () => {
    const original: CaptureOptions = { png: false, jpeg: false, html: true };
    const proto = captureOptionsToProto(original);
    const result = captureOptionsFromProto(proto);
    expect(result).toEqual(original);
  });

  it("should preserve all enabled options through roundtrip", () => {
    const original: CaptureOptions = { png: true, jpeg: true, html: true };
    const proto = captureOptionsToProto(original);
    const result = captureOptionsFromProto(proto);
    expect(result).toEqual(original);
  });

  it("should preserve png and jpeg enabled options through roundtrip", () => {
    const original: CaptureOptions = { png: true, jpeg: true, html: false };
    const proto = captureOptionsToProto(original);
    const result = captureOptionsFromProto(proto);
    expect(result).toEqual(original);
  });
});
