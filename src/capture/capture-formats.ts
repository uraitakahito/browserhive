/**
 * Capture Formats - Flag-based capture output format configuration
 */
import { err, ok, type Result } from "../result.js";

/**
 * Capture formats interface
 *
 * At least one format must be enabled.
 */
export interface CaptureFormats {
  png: boolean;
  jpeg: boolean;
  html: boolean;
  links: boolean;
}

export const validateCaptureFormats = (
  formats: CaptureFormats,
): Result<void, string> => {
  if (!formats.png && !formats.jpeg && !formats.html && !formats.links) {
    return err("At least one capture format must be enabled (png, jpeg, html, or links)");
  }
  return ok();
};

