/**
 * Capture Options - Flag-based capture format configuration
 */
import { CaptureOptions as ProtoCaptureOptions } from "../grpc/generated/browserhive/v1/capture.js";
import type { ValidationResult } from "./types.js";

/**
 * Capture options interface
 *
 * At least one option must be enabled.
 */
export interface CaptureOptions {
  png: boolean;
  jpeg: boolean;
  html: boolean;
}

export const validateCaptureOptions = (options: CaptureOptions): ValidationResult => {
  if (!options.png && !options.jpeg && !options.html) {
    return { valid: false, error: "At least one capture option must be enabled (png, jpeg, or html)" };
  }
  return { valid: true };
};

/**
 * Convert Proto CaptureOptions to TypeScript CaptureOptions
 */
export const captureOptionsFromProto = (
  proto: ProtoCaptureOptions | undefined
): CaptureOptions => {
  if (!proto) {
    return { png: false, jpeg: false, html: false };
  }

  return {
    png: proto.png,
    jpeg: proto.jpeg,
    html: proto.html,
  };
};

/**
 * Convert TypeScript CaptureOptions to Proto CaptureOptions
 */
export const captureOptionsToProto = (
  options: CaptureOptions
): ProtoCaptureOptions => {
  return {
    png: options.png,
    jpeg: options.jpeg,
    html: options.html,
  };
};
