/**
 * Test Configuration Helpers
 *
 * Helper functions for creating test configurations.
 */
import type { CaptureConfig, WorkerConfig, ServerConfig } from "../../src/config/index.js";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_WORKER_CONFIG,
  DEFAULT_SERVER_CONFIG,
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
 * Create a test WorkerConfig with optional overrides
 */
export const createTestWorkerConfig = (
  overrides: DeepPartial<WorkerConfig> = {}
): WorkerConfig => ({
  browsers: overrides.browsers ?? DEFAULT_WORKER_CONFIG.browsers,
  capture: createTestCaptureConfig(overrides.capture),
});

/**
 * Create a test ServerConfig with optional overrides
 */
export const createTestServerConfig = (
  overrides: DeepPartial<ServerConfig> = {}
): ServerConfig => ({
  port: overrides.port ?? DEFAULT_SERVER_CONFIG.port,
  ...(overrides.tls && { tls: overrides.tls }),
  worker: createTestWorkerConfig(overrides.worker),
});
