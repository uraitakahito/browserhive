/**
 * Server CLI
 *
 * CLI logic for the gRPC capture server.
 */
import { Command, InvalidArgumentError } from "commander";
import { CaptureServer } from "../grpc/server.js";
import type { ServerConfig, TlsConfig } from "../config/index.js";
import { DEFAULT_SERVER_CONFIG } from "../config/index.js";
import { logger } from "../logger.js";


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
  maxRetries: number;
  queuePollIntervalMs: number;
  viewportWidth: number;
  viewportHeight: number;
  screenshotFullPage: boolean;
  screenshotQuality?: number;
  rejectDuplicateUrls: boolean;
  tlsCert?: string;
  tlsKey?: string;
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

const buildServerConfig = (opts: ParsedOptions): ServerConfig => {
  const tls = buildTlsConfig(opts);

  return {
    port: opts.port,
    ...(tls && { tls }),
    worker: {
      browsers: opts.browserUrl.map((url) => ({ browserURL: url })),
      capture: {
        outputDir: opts.output,
        timeouts: {
          pageLoad: opts.pageLoadTimeout,
          capture: opts.captureTimeout,
        },
        maxRetries: opts.maxRetries,
        queuePollIntervalMs: opts.queuePollIntervalMs,
        viewport: {
          width: opts.viewportWidth,
          height: opts.viewportHeight,
        },
        screenshot: {
          fullPage: opts.screenshotFullPage,
          ...(opts.screenshotQuality !== undefined && { quality: opts.screenshotQuality }),
        },
        rejectDuplicateUrls: opts.rejectDuplicateUrls,
      },
    },
  };
};

export const createProgram = (): Command => {
  const defaults = DEFAULT_SERVER_CONFIG;
  const defaultCapture = defaults.worker.capture;

  const program = new Command();

  program
    .name("browserhive-server")
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
      "--max-retries <n>",
      `Max retry count for failed capture tasks (default: ${String(defaultCapture.maxRetries)})`,
      parseNonNegativeInt,
      defaultCapture.maxRetries
    )
    .option(
      "--queue-poll-interval <ms>",
      `Queue poll interval in milliseconds when queue is empty (default: ${String(defaultCapture.queuePollIntervalMs)})`,
      parsePositiveInt,
      defaultCapture.queuePollIntervalMs
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

export const parseCliOptions = (argv: string[]): ServerConfig => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<ParsedOptions>();

  // TLS options validation: both or neither
  if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
    program.error("Both --tls-cert and --tls-key must be specified together");
  }

  return buildServerConfig(opts);
};

export const logServerConfig = (config: ServerConfig): void => {
  const capture = config.worker.capture;

  logger.info(
    {
      port: config.port,
      tls: config.tls
        ? { enabled: true, certPath: config.tls.certPath }
        : { enabled: false },
      browsers: config.worker.browsers.map((b) => b.browserURL),
      outputDir: capture.outputDir,
      timeouts: {
        pageLoad: capture.timeouts.pageLoad,
        capture: capture.timeouts.capture,
      },
      maxRetries: capture.maxRetries,
      queuePollIntervalMs: capture.queuePollIntervalMs,
      viewport: {
        width: capture.viewport.width,
        height: capture.viewport.height,
      },
      screenshot: {
        fullPage: capture.screenshot.fullPage,
        ...(capture.screenshot.quality !== undefined && { quality: capture.screenshot.quality }),
      },
      rejectDuplicateUrls: capture.rejectDuplicateUrls,
    },
    "Server configuration"
  );
};

/** Server control interface */
export interface ServerControl {
  shutdown: () => Promise<void>;
}

/**
 * Create, initialize, and start a CaptureServer instance.
 * The returned control interface allows graceful shutdown.
 *
 * @returns Server control interface with shutdown function
 */
export const startServer = async (
  config: ServerConfig
): Promise<ServerControl> => {
  const server = new CaptureServer(config);

  await server.initialize();
  await server.start();

  return {
    shutdown: async (): Promise<void> => {
      logger.info("Received shutdown signal");
      await server.shutdown();
    },
  };
};
