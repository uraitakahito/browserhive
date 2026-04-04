/**
 * Configuration Types
 *
 * Hierarchical configuration structure for the application.
 * ServerConfig > CoordinatorConfig > CaptureConfig
 */

/** Screenshot configuration compatible with Puppeteer ScreenshotOptions */
export interface ScreenshotConfig {
  /** Capture full page screenshot */
  fullPage: boolean;
  /** Image quality (1-100, only for jpeg) */
  quality?: number;
}

/** Capture configuration (lowest layer) */
export interface CaptureConfig {
  /** Output directory for captured files */
  outputDir: string;
  /** Timeout settings */
  timeouts: {
    /** Page load timeout in milliseconds */
    pageLoad: number;
    /** Capture operation timeout in milliseconds */
    capture: number;
  };
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  /** Screenshot options */
  screenshot: ScreenshotConfig;
  /** Custom User-Agent string (uses browser default if undefined) */
  userAgent?: string;
  /** Accept-Language header value (e.g., "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7") */
  acceptLanguage?: string;
}

/** Coordinator configuration (middle layer) */
export interface CoordinatorConfig {
  /** List of browser connection options */
  browsers: BrowserOptions[];
  /** Maximum retry count for failed capture tasks */
  maxRetries: number;
  /** Queue poll interval in milliseconds when queue is empty */
  queuePollIntervalMs: number;
  /** Reject capture requests for URLs already in the queue */
  rejectDuplicateUrls: boolean;
  /** Capture configuration */
  capture: CaptureConfig;
}

/** Server TLS configuration */
export interface TlsConfig {
  /** Whether to enable TLS */
  enabled: boolean;
  /** Server certificate file path */
  certPath: string;
  /** Private key file path */
  keyPath: string;
}

/** Client TLS configuration */
export interface ClientTlsConfig {
  /** Whether to enable TLS */
  enabled: boolean;
  /** CA certificate file path (for server verification) */
  caCertPath: string;
}

/** Server configuration (top layer) */
export interface ServerConfig {
  /** gRPC server port */
  port: number;
  /** TLS configuration (insecure if undefined) */
  tls?: TlsConfig;
  coordinator: CoordinatorConfig;
}

/** Browser connection configuration */
export interface BrowserOptions {
  /** Remote browser URL (e.g., http://puppeteer:9222) */
  browserURL: string;
  /** Slow down Puppeteer operations by the specified milliseconds */
  slowMo?: number;
}
