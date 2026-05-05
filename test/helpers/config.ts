/**
 * Test Configuration Helpers
 *
 * Helper functions for creating test configurations.
 */
import { join } from "node:path";
import type {
  CaptureConfig,
  CoordinatorConfig,
  BrowserHiveConfig,
  BrowserProfile,
  StorageConfig,
} from "../../src/config/index.js";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_COORDINATOR_CONFIG,
  DEFAULT_BROWSERHIVE_CONFIG,
} from "../../src/config/index.js";
import type {
  ArtifactContentType,
  ArtifactStore,
} from "../../src/storage/index.js";

/**
 * Minimal valid `StorageConfig` for tests that only need a structurally
 * complete object (no S3 client is exercised — `CaptureCoordinator`
 * constructs an `S3ArtifactStore` lazily and tests that need real S3
 * behaviour mock the SDK directly).
 */
export const TEST_STORAGE_CONFIG: StorageConfig = {
  endpoint: "http://test-s3.invalid",
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "AKIATESTACCESSKEYID",
  secretAccessKey: "test-secret-access-key-value",
  forcePathStyle: true,
};

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
  storage: (overrides.storage as CoordinatorConfig["storage"] | undefined) ?? TEST_STORAGE_CONFIG,
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

/**
 * In-memory `ArtifactStore` for tests. Records every `put()` call and
 * returns a path-shaped location string so assertions on
 * `CaptureResult.{pngLocation,…}` keep working without touching the
 * network or the AWS SDK.
 *
 * `prefix` is purely for the returned location string — no I/O is
 * performed here. Tests that need to exercise actual S3 client behaviour
 * use `aws-sdk-client-mock` directly (see `test/storage/s3-store.test.ts`).
 */
export interface FakeArtifactPut {
  filename: string;
  body: Buffer | string;
  contentType: ArtifactContentType;
}

export interface FakeArtifactStore extends ArtifactStore {
  readonly puts: FakeArtifactPut[];
  readonly initializeCalls: number;
}

export const createTestArtifactStore = (
  prefix = "/tmp/bh-test-out",
): FakeArtifactStore => {
  const puts: FakeArtifactPut[] = [];
  let initializeCalls = 0;
  return {
    get puts() {
      return puts;
    },
    get initializeCalls() {
      return initializeCalls;
    },
    initialize(): Promise<void> {
      initializeCalls += 1;
      return Promise.resolve();
    },
    put(filename, body, contentType): Promise<string> {
      puts.push({ filename, body, contentType });
      return Promise.resolve(join(prefix, filename));
    },
  };
};
