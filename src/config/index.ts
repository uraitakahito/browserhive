/**
 * Configuration Module (Barrel File)
 */
export type {
  CaptureConfig,
  WorkerConfig,
  ServerConfig,
  BrowserOptions,
  TlsConfig,
  ClientTlsConfig,
} from "./types.js";
export {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_WORKER_CONFIG,
  DEFAULT_SERVER_CONFIG,
  DEFAULT_BROWSER_SLOW_MO_MS,
  DEFAULT_DYNAMIC_CONTENT_WAIT_MS,
} from "./defaults.js";
