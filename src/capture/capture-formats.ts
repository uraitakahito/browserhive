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
  webp: boolean;
  html: boolean;
  links: boolean;
  mhtml: boolean;
  /** Record the full HTTP session as a WACZ archive (replay via ReplayWeb.page). */
  wacz: boolean;
}

export const validateCaptureFormats = (
  formats: CaptureFormats,
): Result<void, string> => {
  if (
    !formats.png &&
    !formats.webp &&
    !formats.html &&
    !formats.links &&
    !formats.mhtml &&
    !formats.wacz
  ) {
    return err(
      "At least one capture format must be enabled (png, webp, html, links, mhtml, or wacz)",
    );
  }
  return ok();
};

