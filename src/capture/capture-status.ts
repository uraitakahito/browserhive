/**
 * Unified Capture Status definitions
 */
export const CAPTURE_STATUS_DEFINITIONS = {
  success: {
    isSuccess: true,
  },
  failed: {
    isSuccess: false,
  },
  timeout: {
    isSuccess: false,
  },
} as const;

/** CaptureStatus type (auto-derived from definitions) */
export type CaptureStatus = keyof typeof CAPTURE_STATUS_DEFINITIONS;

/** Status constants (for direct reference) */
export const captureStatus = {
  success: "success",
  failed: "failed",
  timeout: "timeout",
} as const satisfies Record<string, CaptureStatus>;

/**
 * Check if status indicates success
 */
export const isSuccessStatus = (status: CaptureStatus): boolean => {
  return CAPTURE_STATUS_DEFINITIONS[status].isSuccess;
};

