/**
 * Configuration Module (Barrel File)
 */
export type {
  CaptureConfig,
  CoordinatorConfig,
  BrowserHiveConfig,
  BrowserOptions,
  TlsConfig,
  ClientTlsConfig,
} from "./types.js";
export {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_COORDINATOR_CONFIG,
  DEFAULT_BROWSERHIVE_CONFIG,
  DEFAULT_BROWSER_SLOW_MO_MS,
  DEFAULT_DYNAMIC_CONTENT_WAIT_MS,
} from "./defaults.js";
