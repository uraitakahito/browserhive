/**
 * Test Configuration Helpers
 *
 * Helper functions for creating test configurations.
 */
import type { CaptureConfig, CoordinatorConfig, BrowserHiveConfig, BrowserProfile } from "../../src/config/index.js";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_COORDINATOR_CONFIG,
  DEFAULT_BROWSERHIVE_CONFIG,
} from "../../src/config/index.js";

/** Deep partial type for nested object overrides */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends unknown[]
    ? T[P]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

/**
 * Create a test CaptureConfig with optional overrides
 */
export const createTestCaptureConfig = (
  overrides: DeepPartial<CaptureConfig> = {}
): CaptureConfig => ({
  ...DEFAULT_CAPTURE_CONFIG,
  ...overrides,
  timeouts: {
    ...DEFAULT_CAPTURE_CONFIG.timeouts,
    ...overrides.timeouts,
  },
  viewport: {
    ...DEFAULT_CAPTURE_CONFIG.viewport,
    ...overrides.viewport,
  },
  screenshot: {
    ...DEFAULT_CAPTURE_CONFIG.screenshot,
    ...overrides.screenshot,
  },
});

/**
 * Create a test CoordinatorConfig with optional overrides
 */
export const createTestBrowserProfile = (
  browserURL: string,
  captureOverrides: DeepPartial<CaptureConfig> = {}
): BrowserProfile => ({
  browserURL,
  capture: createTestCaptureConfig(captureOverrides),
});

export const createTestCoordinatorConfig = (
  overrides: DeepPartial<CoordinatorConfig> = {}
): CoordinatorConfig => ({
  browserProfiles: overrides.browserProfiles ?? DEFAULT_COORDINATOR_CONFIG.browserProfiles,
  maxRetryCount: overrides.maxRetryCount ?? DEFAULT_COORDINATOR_CONFIG.maxRetryCount,
  queuePollIntervalMs: overrides.queuePollIntervalMs ?? DEFAULT_COORDINATOR_CONFIG.queuePollIntervalMs,
  rejectDuplicateUrls: overrides.rejectDuplicateUrls ?? DEFAULT_COORDINATOR_CONFIG.rejectDuplicateUrls,
});

/**
 * Create a test BrowserHiveConfig with optional overrides
 */
export const createTestBrowserHiveConfig = (
  overrides: DeepPartial<BrowserHiveConfig> = {}
): BrowserHiveConfig => ({
  port: overrides.port ?? DEFAULT_BROWSERHIVE_CONFIG.port,
  ...(overrides.tls && { tls: overrides.tls }),
  coordinator: createTestCoordinatorConfig(overrides.coordinator),
});
