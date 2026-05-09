/**
 * Configuration Module (Barrel File)
 */
export type {
  BrowserConnectOptions,
  CaptureConfig,
  CoordinatorConfig,
  BrowserHiveConfig,
  BrowserProfile,
  HttpServerConfig,
  ResetPageStateConfig,
  StorageConfig,
  TlsConfig,
  ClientTlsConfig,
  WaczConfig,
} from "./types.js";
export {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_COORDINATOR_CONFIG,
  DEFAULT_BROWSERHIVE_CONFIG,
  DEFAULT_BROWSER_SLOW_MO_MS,
  DEFAULT_DYNAMIC_CONTENT_WAIT_MS,
  DEFAULT_WACZ_CONFIG,
  DEFAULT_WACZ_BLOCK_PATTERNS,
  DEFAULT_WACZ_FUZZY_PARAMS,
} from "./defaults.js";
