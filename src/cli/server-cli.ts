/**
 * Server CLI
 *
 * CLI logic for the gRPC capture server.
 */
import { Command, InvalidArgumentError } from "commander";
import { BrowserHive } from "../browserhive.js";
import type { CoordinatorInitFailure } from "../capture/index.js";
import type { BrowserHiveConfig, TlsConfig, CaptureConfig } from "../config/index.js";
import { DEFAULT_BROWSERHIVE_CONFIG, DEFAULT_CAPTURE_CONFIG } from "../config/index.js";
import { logger } from "../logger.js";
import { err, ok, type Result } from "../result.js";


// Custom parsers for option validation
const parsePort = (value: string): number => {
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError("Port must be between 1 and 65535");
  }
  return port;
};

const parsePositiveInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new InvalidArgumentError("Must be a positive integer");
  }
  return num;
};

const parseNonNegativeInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new InvalidArgumentError("Must be a non-negative integer");
  }
  return num;
};

const parseQuality = (value: string): number => {
  const quality = parseInt(value, 10);
  if (isNaN(quality) || quality < 1 || quality > 100) {
    throw new InvalidArgumentError("Quality must be between 1 and 100");
  }
  return quality;
};

interface ParsedOptions {
  port: number;
  browserUrl: string[];
  output: string;
  pageLoadTimeout: number;
  captureTimeout: number;
  maxRetryCount: number;
  queuePollIntervalMs: number;
  viewportWidth: number;
  viewportHeight: number;
  screenshotFullPage: boolean;
  screenshotQuality?: number;
  rejectDuplicateUrls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  userAgent?: string;
  acceptLanguage?: string;
}

const buildTlsConfig = (opts: ParsedOptions): TlsConfig | undefined => {
  if (opts.tlsCert && opts.tlsKey) {
    return {
      enabled: true,
      certPath: opts.tlsCert,
      keyPath: opts.tlsKey,
    };
  }
  return undefined;
};

const buildServerConfig = (opts: ParsedOptions): BrowserHiveConfig => {
  const tls = buildTlsConfig(opts);

  const capture: CaptureConfig = {
    outputDir: opts.output,
    timeouts: {
      pageLoad: opts.pageLoadTimeout,
      capture: opts.captureTimeout,
    },
    viewport: {
      width: opts.viewportWidth,
      height: opts.viewportHeight,
    },
    screenshot: {
      fullPage: opts.screenshotFullPage,
      ...(opts.screenshotQuality !== undefined && { quality: opts.screenshotQuality }),
    },
    ...(opts.userAgent !== undefined && { userAgent: opts.userAgent }),
    ...(opts.acceptLanguage !== undefined && { acceptLanguage: opts.acceptLanguage }),
  };

  return {
    port: opts.port,
    ...(tls && { tls }),
    coordinator: {
      browserProfiles: opts.browserUrl.map((url) => ({ browserURL: url, capture })),
      maxRetryCount: opts.maxRetryCount,
      queuePollIntervalMs: opts.queuePollIntervalMs,
      rejectDuplicateUrls: opts.rejectDuplicateUrls,
    },
  };
};

export const createProgram = (): Command => {
  const defaults = DEFAULT_BROWSERHIVE_CONFIG;
  const defaultWorker = defaults.coordinator;
  const defaultCapture = DEFAULT_CAPTURE_CONFIG;

  const program = new Command();

  program
    .name("browserhive")
    .description("gRPC Capture Server - Accept capture requests via gRPC")
    .option(
      "--port <port>",
      `gRPC server port (default: ${String(defaults.port)})`,
      parsePort,
      defaults.port
    )
    .requiredOption(
      "--browser-url <urls...>",
      "Browser URLs (required, can specify multiple)"
    )
    // Why --output is required:
    // Previously, the default value was calculated as a relative path from the executable location,
    // but the output destination differed between `npx tsx bin/server.ts` and `node dist/bin/server.js`,
    // causing confusion. Therefore, explicit specification is enforced.
    .requiredOption(
      "--output <dir>",
      "Output directory for captured files (required)"
    )
    .option(
      "--page-load-timeout <ms>",
      `Page load timeout in milliseconds (default: ${String(defaultCapture.timeouts.pageLoad)})`,
      parsePositiveInt,
      defaultCapture.timeouts.pageLoad
    )
    .option(
      "--capture-timeout <ms>",
      `Capture timeout in milliseconds (default: ${String(defaultCapture.timeouts.capture)})`,
      parsePositiveInt,
      defaultCapture.timeouts.capture
    )
    .option(
      "--max-retry-count <n>",
      `Max retry count for failed capture tasks (default: ${String(defaultWorker.maxRetryCount)})`,
      parseNonNegativeInt,
      defaultWorker.maxRetryCount
    )
    .option(
      "--queue-poll-interval <ms>",
      `Queue poll interval in milliseconds when queue is empty (default: ${String(defaultWorker.queuePollIntervalMs)})`,
      parsePositiveInt,
      defaultWorker.queuePollIntervalMs
    )
    .option(
      "--viewport-width <px>",
      `Viewport width in pixels (default: ${String(defaultCapture.viewport.width)})`,
      parsePositiveInt,
      defaultCapture.viewport.width
    )
    .option(
      "--viewport-height <px>",
      `Viewport height in pixels (default: ${String(defaultCapture.viewport.height)})`,
      parsePositiveInt,
      defaultCapture.viewport.height
    )
    .option(
      "--screenshot-full-page",
      `Capture full page screenshot (default: ${String(defaultCapture.screenshot.fullPage)})`,
      defaultCapture.screenshot.fullPage
    )
    .option(
      "--screenshot-quality <n>",
      "JPEG quality (1-100)",
      parseQuality
    )
    .option(
      "--reject-duplicate-urls",
      "Reject capture requests for URLs already in the queue (default: false)",
      false
    )
    .option(
      "--user-agent <string>",
      "Custom User-Agent string (uses browser default if not specified)"
    )
    .option(
      "--accept-language <string>",
      "Accept-Language header value (e.g., 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7')"
    )
    .option(
      "--tls-cert <path>",
      "TLS certificate file path (enables TLS when specified with --tls-key)"
    )
    .option(
      "--tls-key <path>",
      "TLS private key file path (enables TLS when specified with --tls-cert)"
    )
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .showHelpAfterError(true);

  return program;
};

export const parseCliOptions = (argv: string[]): BrowserHiveConfig => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<ParsedOptions>();

  // TLS options validation: both or neither
  if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
    program.error("Both --tls-cert and --tls-key must be specified together");
  }

  return buildServerConfig(opts);
};

export const logServerConfig = (config: BrowserHiveConfig): void => {
  const coordinator = config.coordinator;
  const capture = coordinator.browserProfiles[0]?.capture ?? DEFAULT_CAPTURE_CONFIG;

  logger.info(
    {
      port: config.port,
      tls: config.tls
        ? { enabled: true, certPath: config.tls.certPath }
        : { enabled: false },
      browserProfiles: coordinator.browserProfiles.map((b) => b.browserURL),
      outputDir: capture.outputDir,
      timeouts: {
        pageLoad: capture.timeouts.pageLoad,
        capture: capture.timeouts.capture,
      },
      maxRetryCount: coordinator.maxRetryCount,
      queuePollIntervalMs: coordinator.queuePollIntervalMs,
      viewport: {
        width: capture.viewport.width,
        height: capture.viewport.height,
      },
      screenshot: {
        fullPage: capture.screenshot.fullPage,
        ...(capture.screenshot.quality !== undefined && { quality: capture.screenshot.quality }),
      },
      rejectDuplicateUrls: coordinator.rejectDuplicateUrls,
      userAgent: capture.userAgent ?? "(browser default)",
      acceptLanguage: capture.acceptLanguage ?? "(browser default)",
    },
    "Server configuration"
  );
};

/** Server control interface */
export interface ServerControl {
  shutdown: () => Promise<void>;
}

/**
 * Render a CoordinatorInitFailure as a single-line human-readable string for
 * the Fatal error log line.
 */
export const formatInitFailure = (failure: CoordinatorInitFailure): string => {
  if (failure.kind === "no-profiles") {
    return "No browser profiles configured";
  }
  const failedList = failure.failed
    .map((f) => `${f.browserURL} (${f.reason.message})`)
    .join(", ");
  return (
    `Worker initialization failed: ${String(failure.operational)}/${String(failure.total)} operational. ` +
    `Failed: [${failedList}]`
  );
};

export const startServer = async (
  config: BrowserHiveConfig
): Promise<Result<ServerControl, CoordinatorInitFailure>> => {
  const server = new BrowserHive(config);

  const initResult = await server.initialize();
  if (!initResult.ok) {
    return err(initResult.error);
  }
  await server.start();

  return ok({
    shutdown: async (): Promise<void> => {
      logger.info("Received shutdown signal");
      await server.shutdown();
    },
  });
};
