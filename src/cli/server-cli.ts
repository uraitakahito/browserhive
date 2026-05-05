/**
 * Server CLI
 *
 * CLI logic for the HTTP capture server.
 *
 * Every option falls back to a `BROWSERHIVE_*` environment variable when the
 * CLI flag is not given. CLI > env > default. The variadic `--browser-url`
 * and the presence-only boolean flags use a manual post-parse env merge —
 * commander's `Option#env` covers the scalar cases natively.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { CaptureCoordinator } from "../capture/index.js";
import { HttpServer } from "../http/server.js";
import type {
  BrowserHiveConfig,
  CaptureConfig,
  StorageConfig,
  TlsConfig,
} from "../config/index.js";
import { DEFAULT_BROWSERHIVE_CONFIG, DEFAULT_CAPTURE_CONFIG } from "../config/index.js";
import { logger } from "../logger.js";

/** Mask AWS-style access key ids in logs (`AKIA…ABCD` → `AKIA****ABCD`). */
const maskAccessKeyId = (id: string): string => {
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}***${id.slice(-4)}`;
};

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
  s3Endpoint?: string;
  s3Region: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3KeyPrefix?: string;
  s3ForcePathStyle: boolean;
  pageLoadTimeout: number;
  captureTimeout: number;
  taskTimeout: number;
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
}

/** Same as ParsedOptions but with all post-resolution fields required. */
interface ResolvedOptions extends Omit<ParsedOptions, "browserUrl"> {
  browserUrl: string[];
  storage: StorageConfig;
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
    timeouts: {
      pageLoad: opts.pageLoadTimeout,
      capture: opts.captureTimeout,
      taskTotal: opts.taskTimeout,
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
  };

  return {
    port: opts.port,
    ...(tls && { tls }),
    coordinator: {
      browserProfiles: opts.browserUrl.map((url) => ({ browserURL: url, capture })),
      storage: opts.storage,
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
    .description("HTTP Capture Server - Accept capture requests via HTTP")
    .addOption(
      new Option("--port <port>", "HTTP server port")
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
      new Option(
        "--s3-endpoint <url>",
        "S3-compatible endpoint URL. Required.",
      ).env("BROWSERHIVE_S3_ENDPOINT"),
    )
    .addOption(
      new Option("--s3-region <region>", "S3 region label")
        .env("BROWSERHIVE_S3_REGION")
        .default("us-east-1"),
    )
    .addOption(
      new Option(
        "--s3-bucket <name>",
        "S3 bucket name. Required.",
      ).env("BROWSERHIVE_S3_BUCKET"),
    )
    .addOption(
      new Option(
        "--s3-access-key-id <id>",
        "S3 access key ID. Required. Prefer the env var to avoid leaking the value via `ps`.",
      ).env("BROWSERHIVE_S3_ACCESS_KEY_ID"),
    )
    .addOption(
      new Option(
        "--s3-secret-access-key <secret>",
        "S3 secret access key. Required. Prefer the env var to avoid leaking the value via `ps`.",
      ).env("BROWSERHIVE_S3_SECRET_ACCESS_KEY"),
    )
    .addOption(
      new Option(
        "--s3-key-prefix <prefix>",
        "Optional prefix prepended to every S3 object key (no trailing slash needed)",
      ).env("BROWSERHIVE_S3_KEY_PREFIX"),
    )
    .option(
      "--s3-force-path-style",
      "Use path-style addressing (env: BROWSERHIVE_S3_FORCE_PATH_STYLE). SeaweedFS / most self-hosted S3 require this; default true.",
      true,
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
      // Layer B per-task safety net. Sized larger than the sum of inner
      // Layer A timeouts; see DEFAULT_CAPTURE_CONFIG.timeouts.taskTotal.
      new Option(
        "--task-timeout <ms>",
        "Total task processing timeout in milliseconds (Layer B safety net)",
      )
        .env("BROWSERHIVE_TASK_TIMEOUT_MS")
        .default(defaultCapture.timeouts.taskTotal)
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

/**
 * Resolve the four mandatory `--s3-*` fields (endpoint / bucket / accessKeyId
 * / secretAccessKey) into a fully-typed `StorageConfig`. `region`,
 * `keyPrefix`, and `forcePathStyle` are filled in from defaults / optional
 * overrides. Each missing or empty required field aborts via `program.error`
 * so the caller can rely on every field being present once this returns.
 */
const resolveStorageConfig = (
  opts: ParsedOptions,
  program: Command,
): StorageConfig => {
  // Per-field early `program.error` (typed `never`) so the rest of this
  // function sees non-undefined types — collecting into a `missing` array
  // would not narrow the individual fields.
  if (opts.s3Endpoint === undefined || opts.s3Endpoint.trim() === "") {
    program.error("--s3-endpoint is required (or set BROWSERHIVE_S3_ENDPOINT)");
  }
  if (opts.s3Bucket === undefined || opts.s3Bucket.trim() === "") {
    program.error("--s3-bucket is required (or set BROWSERHIVE_S3_BUCKET)");
  }
  if (opts.s3AccessKeyId === undefined || opts.s3AccessKeyId === "") {
    program.error(
      "--s3-access-key-id is required (or set BROWSERHIVE_S3_ACCESS_KEY_ID)",
    );
  }
  if (opts.s3SecretAccessKey === undefined || opts.s3SecretAccessKey === "") {
    program.error(
      "--s3-secret-access-key is required (or set BROWSERHIVE_S3_SECRET_ACCESS_KEY)",
    );
  }

  const config: StorageConfig = {
    endpoint: opts.s3Endpoint,
    region: opts.s3Region,
    bucket: opts.s3Bucket,
    accessKeyId: opts.s3AccessKeyId,
    secretAccessKey: opts.s3SecretAccessKey,
    forcePathStyle: opts.s3ForcePathStyle,
    ...(opts.s3KeyPrefix !== undefined && { keyPrefix: opts.s3KeyPrefix }),
  };
  return config;
};

export const parseCliOptions = (argv: string[]): BrowserHiveConfig => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<ParsedOptions>();

  if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
    program.error("Both --tls-cert and --tls-key must be specified together");
  }

  const storage = resolveStorageConfig(opts, program);

  const resolved: ResolvedOptions = {
    ...opts,
    browserUrl: requireBrowserUrls(opts.browserUrl, program),
    storage,
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

/**
 * Render `StorageConfig` into a log-safe object. The S3 access key is
 * partially masked; the secret access key is fully redacted so the
 * server's startup log (which is often centralised) cannot leak it.
 */
const logSafeStorage = (
  storage: StorageConfig,
): Record<string, unknown> => ({
  endpoint: storage.endpoint,
  region: storage.region,
  bucket: storage.bucket,
  accessKeyId: maskAccessKeyId(storage.accessKeyId),
  secretAccessKey: "***",
  ...(storage.keyPrefix !== undefined && { keyPrefix: storage.keyPrefix }),
  forcePathStyle: storage.forcePathStyle ?? true,
});

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
      storage: logSafeStorage(coordinator.storage),
      timeouts: {
        pageLoad: capture.timeouts.pageLoad,
        capture: capture.timeouts.capture,
        taskTotal: capture.timeouts.taskTotal,
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
  const coordinator = new CaptureCoordinator(config.coordinator);
  const server = new HttpServer(coordinator, {
    port: config.port,
    ...(config.tls && { tls: config.tls }),
  });

  await server.initialize();
  await server.start();

  return {
    shutdown: async (): Promise<void> => {
      logger.info("Received shutdown signal");
      await server.shutdown();
    },
  };
};
