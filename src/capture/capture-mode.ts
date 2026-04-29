/**
 * Capture Options - Flag-based capture format configuration
 */
import { err, ok, type Result } from "../result.js";

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

export const validateCaptureOptions = (
  options: CaptureOptions,
): Result<void, string> => {
  if (!options.png && !options.jpeg && !options.html) {
    return err("At least one capture option must be enabled (png, jpeg, or html)");
  }
  return ok();
};

