/**
 * Capture Options - Flag-based capture format configuration
 */
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

