/**
 * Server CLI
 *
 * CLI logic for the gRPC capture server.
 *
 * Every option falls back to a `BROWSERHIVE_*` environment variable when the
 * CLI flag is not given. CLI > env > default. The variadic `--browser-url`
 * and the presence-only boolean flags use a manual post-parse env merge —
 * commander's `Option#env` covers the scalar cases natively.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { BrowserHive } from "../browserhive.js";
import type { BrowserHiveConfig, TlsConfig, CaptureConfig } from "../config/index.js";
import { DEFAULT_BROWSERHIVE_CONFIG, DEFAULT_CAPTURE_CONFIG } from "../config/index.js";
import { logger } from "../logger.js";

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

/**
 * Parse a boolean from an environment-variable-style string.
 * Accepts `"true"`/`"1"` → true, `"false"`/`"0"`/`""` → false. Throws otherwise.
 */
const parseEnvBool = (value: string, varName: string): boolean => {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0" || v === "") return false;
  throw new InvalidArgumentError(
    `${varName} must be "true"/"1" or "false"/"0" (got "${value}")`,
  );
};

interface ParsedOptions {
  port: number;
  browserUrl?: string[];
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

/** Same as ParsedOptions but with all post-resolution fields required. */
interface ResolvedOptions extends Omit<ParsedOptions, "browserUrl"> {
  browserUrl: string[];
}

const buildTlsConfig = (opts: ResolvedOptions): TlsConfig | undefined => {
  if (opts.tlsCert && opts.tlsKey) {
    return {
      enabled: true,
      certPath: opts.tlsCert,
      keyPath: opts.tlsKey,
    };
  }
  return undefined;
};

const buildServerConfig = (opts: ResolvedOptions): BrowserHiveConfig => {
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
    .addOption(
      new Option("--port <port>", "gRPC server port")
        .env("BROWSERHIVE_PORT")
        .default(defaults.port)
        .argParser(parsePort),
    )
    .addOption(
      new Option(
        "--browser-url <urls...>",
        "Browser URLs (env: BROWSERHIVE_BROWSER_URLS, comma-separated). Required.",
      ),
    )
    .addOption(
      new Option("--output <dir>", "Output directory for captured files. Required.")
        .env("BROWSERHIVE_OUTPUT_DIR")
        .makeOptionMandatory(true),
    )
    .addOption(
      new Option("--page-load-timeout <ms>", "Page load timeout in milliseconds")
        .env("BROWSERHIVE_PAGE_LOAD_TIMEOUT_MS")
        .default(defaultCapture.timeouts.pageLoad)
        .argParser(parsePositiveInt),
    )
    .addOption(
      new Option("--capture-timeout <ms>", "Capture timeout in milliseconds")
        .env("BROWSERHIVE_CAPTURE_TIMEOUT_MS")
        .default(defaultCapture.timeouts.capture)
        .argParser(parsePositiveInt),
    )
    .addOption(
      new Option("--max-retry-count <n>", "Max retry count for failed capture tasks")
        .env("BROWSERHIVE_MAX_RETRY_COUNT")
        .default(defaultWorker.maxRetryCount)
        .argParser(parseNonNegativeInt),
    )
    .addOption(
      new Option(
        "--queue-poll-interval-ms <ms>",
        "Queue poll interval in milliseconds when queue is empty",
      )
        .env("BROWSERHIVE_QUEUE_POLL_INTERVAL_MS")
        .default(defaultWorker.queuePollIntervalMs)
        .argParser(parsePositiveInt),
    )
    .addOption(
      new Option("--viewport-width <px>", "Viewport width in pixels")
        .env("BROWSERHIVE_VIEWPORT_WIDTH")
        .default(defaultCapture.viewport.width)
        .argParser(parsePositiveInt),
    )
    .addOption(
      new Option("--viewport-height <px>", "Viewport height in pixels")
        .env("BROWSERHIVE_VIEWPORT_HEIGHT")
        .default(defaultCapture.viewport.height)
        .argParser(parsePositiveInt),
    )
    .option(
      "--screenshot-full-page",
      "Capture full page screenshot (env: BROWSERHIVE_SCREENSHOT_FULL_PAGE)",
      defaultCapture.screenshot.fullPage,
    )
    .addOption(
      new Option("--screenshot-quality <n>", "JPEG quality (1-100)")
        .env("BROWSERHIVE_SCREENSHOT_QUALITY")
        .argParser(parseQuality),
    )
    .option(
      "--reject-duplicate-urls",
      "Reject capture requests for URLs already in the queue (env: BROWSERHIVE_REJECT_DUPLICATE_URLS)",
      false,
    )
    .addOption(
      new Option(
        "--user-agent <string>",
        "Custom User-Agent string (uses browser default if not specified)",
      ).env("BROWSERHIVE_USER_AGENT"),
    )
    .addOption(
      new Option(
        "--accept-language <string>",
        "Accept-Language header value (e.g., 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7')",
      ).env("BROWSERHIVE_ACCEPT_LANGUAGE"),
    )
    .addOption(
      new Option(
        "--tls-cert <path>",
        "TLS certificate file path (enables TLS when specified with --tls-key)",
      ).env("BROWSERHIVE_TLS_CERT"),
    )
    .addOption(
      new Option(
        "--tls-key <path>",
        "TLS private key file path (enables TLS when specified with --tls-cert)",
      ).env("BROWSERHIVE_TLS_KEY"),
    )
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .showHelpAfterError(true);

  return program;
};

const splitCsv = (raw: string): string[] =>
  raw.split(",").map((s) => s.trim()).filter((s) => s !== "");

/**
 * Variadic `--browser-url` cannot be expressed via commander's `Option#env`,
 * so we merge the env value manually after parsing. CLI wins; env is a
 * comma-separated list. Calls `program.error` (which exits) when the source
 * is missing entirely.
 */
const requireBrowserUrls = (
  cliValue: string[] | undefined,
  program: Command,
): string[] => {
  if (cliValue !== undefined && cliValue.length > 0) return cliValue;
  const envRaw = process.env["BROWSERHIVE_BROWSER_URLS"];
  if (envRaw !== undefined) {
    const parsed = splitCsv(envRaw);
    if (parsed.length > 0) return parsed;
  }
  program.error(
    "--browser-url is required (or set BROWSERHIVE_BROWSER_URLS as comma-separated list)",
  );
};

/**
 * Presence-only boolean flags: CLI true wins; otherwise consult the env.
 * Throws via `program.error` (process exit, or interceptable via
 * `program.exitOverride()` in tests) when the env value is malformed.
 */
const resolveBoolWithEnv = (
  cliValue: boolean,
  envName: string,
  program: Command,
): boolean => {
  if (cliValue) return true;
  const raw = process.env[envName];
  if (raw === undefined) return false;
  try {
    return parseEnvBool(raw, envName);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Invalid ${envName}: ${raw}`;
    program.error(message);
  }
};

export const parseCliOptions = (argv: string[]): BrowserHiveConfig => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<ParsedOptions>();

  if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
    program.error("Both --tls-cert and --tls-key must be specified together");
  }

  const resolved: ResolvedOptions = {
    ...opts,
    browserUrl: requireBrowserUrls(opts.browserUrl, program),
    screenshotFullPage: resolveBoolWithEnv(
      opts.screenshotFullPage,
      "BROWSERHIVE_SCREENSHOT_FULL_PAGE",
      program,
    ),
    rejectDuplicateUrls: resolveBoolWithEnv(
      opts.rejectDuplicateUrls,
      "BROWSERHIVE_REJECT_DUPLICATE_URLS",
      program,
    ),
  };

  return buildServerConfig(resolved);
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
    "Server configuration",
  );
};

/** Server control interface */
export interface ServerControl {
  shutdown: () => Promise<void>;
}

export const startServer = async (
  config: BrowserHiveConfig,
): Promise<ServerControl> => {
  const server = new BrowserHive(config);

  await server.initialize();
  await server.start();

  return {
    shutdown: async (): Promise<void> => {
      logger.info("Received shutdown signal");
      await server.shutdown();
    },
  };
};
