export const captureStatus = {
  success: "success",
  failed: "failed",
  timeout: "timeout",
  httpError: "httpError",
} as const;

export type CaptureStatus = (typeof captureStatus)[keyof typeof captureStatus];

export const isSuccessStatus = (status: CaptureStatus): boolean => {
  return status === captureStatus.success;
};

