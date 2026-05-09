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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { CaptureCoordinator } from "../capture/index.js";
import { HttpServer } from "../http/server.js";
import type {
  BrowserHiveConfig,
  CaptureConfig,
  StorageConfig,
  TlsConfig,
  WaczConfig,
} from "../config/index.js";
import {
  DEFAULT_BROWSERHIVE_CONFIG,
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_WACZ_CONFIG,
} from "../config/index.js";
import { logger } from "../logger.js";

/**
 * Read the package version once at module load so the WARC `warcinfo`
 * record carries the real BrowserHive version (e.g. `browserhive/1.0.0`)
 * rather than the literal default. The path resolution mirrors how
 * `http/server.ts` finds `dist/openapi.dereferenced.json` — walks two
 * levels up from the compiled file location to reach the project root.
 */
const readPackageVersion = (): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(here, "..", "..", "..");
    const raw = readFileSync(join(projectRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const SOFTWARE_IDENTIFIER = `browserhive/${readPackageVersion()}`;

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
  /**
   * Commander auto-generates `--no-reset-cookies` for any boolean option;
   * default `true` flips to `false` when the negation flag is present. Env
   * (`BROWSERHIVE_RESET_COOKIES`) is merged post-parse via
   * `resolveBoolWithEnvDefaultTrue` so an env override only kicks in when
   * the CLI did not explicitly negate.
   */
  resetCookies: boolean;
  /** See {@link ParsedOptions.resetCookies}; controls `about:blank` between tasks. */
  resetPageContext: boolean;
  // WACZ filter / limit settings — every field has a CLI flag and a
  // `BROWSERHIVE_WACZ_*` env equivalent.
  waczMaxResponseBytes: number;
  waczMaxTaskBytes: number;
  waczMaxPendingRequests: number;
  /** Variadic glob list. Merged with env via post-parse helper. */
  waczBlockPattern?: string[];
  /** Variadic MIME prefix list. Merged with env via post-parse helper. */
  waczSkipContentTypes?: string[];
  /** Variadic fuzzy query-param names. Merged with env via post-parse helper. */
  waczFuzzyParam?: string[];
  tlsCert?: string;
  tlsKey?: string;
  userAgent?: string;
}

/** Same as ParsedOptions but with all post-resolution fields required. */
interface ResolvedOptions
  extends Omit<
    ParsedOptions,
    | "browserUrl"
    | "waczBlockPattern"
    | "waczSkipContentTypes"
    | "waczFuzzyParam"
  > {
  browserUrl: string[];
  storage: StorageConfig;
  waczBlockPattern: string[];
  waczSkipContentTypes: string[];
  waczFuzzyParam: string[];
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

  // WACZ recorder policy. Each field traces back to a CLI flag (with an
  // env equivalent) — defaults live in `DEFAULT_WACZ_CONFIG`. `software`
  // is always derived from `package.json` so the WARC `warcinfo` carries
  // the real BrowserHive version.
  const wacz: WaczConfig = {
    blockUrlPatterns: opts.waczBlockPattern,
    skipContentTypes: opts.waczSkipContentTypes,
    maxResponseBytes: opts.waczMaxResponseBytes,
    maxTaskBytes: opts.waczMaxTaskBytes,
    maxPendingRequests: opts.waczMaxPendingRequests,
    software: SOFTWARE_IDENTIFIER,
    fuzzyParams: opts.waczFuzzyParam,
  };

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
    resetPageState: {
      cookies: opts.resetCookies,
      pageContext: opts.resetPageContext,
    },
    wacz,
  };

  return {
    http: {
      port: opts.port,
      ...(tls && { tls }),
    },
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
        .default(defaults.http.port)
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
      "Use path-style addressing (env: BROWSERHIVE_S3_FORCE_PATH_STYLE). Required for SeaweedFS / MinIO / most self-hosted S3. Default false (virtual-hosted-style for AWS S3).",
      false,
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
      new Option("--screenshot-quality <n>", "WebP lossy quality (1-100)")
        .env("BROWSERHIVE_SCREENSHOT_QUALITY")
        .argParser(parseQuality),
    )
    .option(
      "--reject-duplicate-urls",
      "Reject capture requests for URLs already in the queue (env: BROWSERHIVE_REJECT_DUPLICATE_URLS)",
      false,
    )
    // Negation-only flags: commander generates `opts.resetCookies` from the
    // `--no-` form, default `true`. Pairing with env (BROWSERHIVE_RESET_COOKIES /
    // BROWSERHIVE_RESET_PAGE_CONTEXT) is done in parseCliOptions via
    // `resolveBoolWithEnvDefaultTrue` — env can flip to false when CLI was not
    // explicitly negated; CLI negation takes precedence over env=true.
    .option(
      "--no-reset-cookies",
      "Skip the inter-task cookie wipe (CDP Network.clearBrowserCookies). Equivalent to BROWSERHIVE_RESET_COOKIES=false. Default: cookies are cleared between captures.",
      true,
    )
    .option(
      "--no-reset-page-context",
      "Skip the inter-task `about:blank` navigation. Equivalent to BROWSERHIVE_RESET_PAGE_CONTEXT=false. Note: also keeps origin-scoped storage (localStorage/sessionStorage/IndexedDB) by default; see docs. Default: about:blank navigation runs between captures.",
      true,
    )
    // WACZ recorder configuration. Every field is server-wide and applies
    // to every capture that requests `wacz: true`.
    .addOption(
      new Option(
        "--wacz-max-response-bytes <n>",
        "WACZ: per-response body cap (bytes). Larger bodies become a metadata `truncated: too-large` record",
      )
        .env("BROWSERHIVE_WACZ_MAX_RESPONSE_BYTES")
        .default(DEFAULT_WACZ_CONFIG.maxResponseBytes)
        .argParser(parsePositiveInt),
    )
    .addOption(
      new Option(
        "--wacz-max-task-bytes <n>",
        "WACZ: cumulative body cap per task (bytes). Subsequent bodies become metadata `truncated: task-cap` records",
      )
        .env("BROWSERHIVE_WACZ_MAX_TASK_BYTES")
        .default(DEFAULT_WACZ_CONFIG.maxTaskBytes)
        .argParser(parsePositiveInt),
    )
    .addOption(
      new Option(
        "--wacz-max-pending-requests <n>",
        "WACZ: cap on the in-flight pending-request map (FIFO eviction when exceeded)",
      )
        .env("BROWSERHIVE_WACZ_MAX_PENDING_REQUESTS")
        .default(DEFAULT_WACZ_CONFIG.maxPendingRequests)
        .argParser(parsePositiveInt),
    )
    .option(
      "--wacz-block-pattern <patterns...>",
      "WACZ: glob patterns matched against full URL — matched URLs are dropped from the WARC. Use `--wacz-block-pattern \"\"` (empty value) to start with no defaults. Env: BROWSERHIVE_WACZ_BLOCK_PATTERNS (comma-separated)",
    )
    .option(
      "--wacz-skip-content-types <prefixes...>",
      "WACZ: MIME prefixes (e.g. video/, audio/). Matching responses have body omitted; request/response meta still recorded. Env: BROWSERHIVE_WACZ_SKIP_CONTENT_TYPES (comma-separated)",
    )
    .option(
      "--wacz-fuzzy-param <names...>",
      "WACZ: query parameter names treated as cache-busters (replay-time fuzzy match). Embedded in fuzzy.json. Env: BROWSERHIVE_WACZ_FUZZY_PARAMS (comma-separated)",
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
 * Variadic list flags (CLI > env > defaultIfBoth) merged into a final
 * `string[]`. Used for `--wacz-block-pattern` / `--wacz-skip-content-types`
 * — both of which accept multiple values and have `BROWSERHIVE_WACZ_*`
 * comma-separated env equivalents. Passing an empty CLI string (`""`)
 * yields `[]`, useful for opting out of the defaults entirely.
 */
const resolveCsvList = (
  cliValue: string[] | undefined,
  envName: string,
  defaultValue: readonly string[],
): string[] => {
  if (cliValue !== undefined) {
    // Empty string in CLI means "no entries" — preserve that intent.
    return cliValue.flatMap(splitCsv);
  }
  const envRaw = process.env[envName];
  if (envRaw !== undefined) {
    return splitCsv(envRaw);
  }
  return [...defaultValue];
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
 * Negation-style boolean flags whose default is `true` (e.g. `--no-reset-cookies`).
 *
 * `cliValue === false` means the user explicitly negated → final result is
 * `false` and the env is ignored (CLI > env). `cliValue === true` means
 * the user did NOT pass the negation flag, so we consult the env: an
 * explicit `false` there flips to `false`; an explicit `true` (or unset)
 * keeps the default `true`. Malformed env values exit via `program.error`.
 */
const resolveBoolWithEnvDefaultTrue = (
  cliValue: boolean,
  envName: string,
  program: Command,
): boolean => {
  if (!cliValue) return false;
  const raw = process.env[envName];
  if (raw === undefined) return true;
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
    // CLI presence-only flag (default false). Merge with env so an
    // explicit `BROWSERHIVE_S3_FORCE_PATH_STYLE=true` flips into
    // path-style addressing for SeaweedFS / MinIO / self-hosted S3.
    forcePathStyle: resolveBoolWithEnv(
      opts.s3ForcePathStyle,
      "BROWSERHIVE_S3_FORCE_PATH_STYLE",
      program,
    ),
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
    resetCookies: resolveBoolWithEnvDefaultTrue(
      opts.resetCookies,
      "BROWSERHIVE_RESET_COOKIES",
      program,
    ),
    resetPageContext: resolveBoolWithEnvDefaultTrue(
      opts.resetPageContext,
      "BROWSERHIVE_RESET_PAGE_CONTEXT",
      program,
    ),
    waczBlockPattern: resolveCsvList(
      opts.waczBlockPattern,
      "BROWSERHIVE_WACZ_BLOCK_PATTERNS",
      DEFAULT_WACZ_CONFIG.blockUrlPatterns,
    ),
    waczSkipContentTypes: resolveCsvList(
      opts.waczSkipContentTypes,
      "BROWSERHIVE_WACZ_SKIP_CONTENT_TYPES",
      DEFAULT_WACZ_CONFIG.skipContentTypes,
    ),
    waczFuzzyParam: resolveCsvList(
      opts.waczFuzzyParam,
      "BROWSERHIVE_WACZ_FUZZY_PARAMS",
      DEFAULT_WACZ_CONFIG.fuzzyParams,
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
  forcePathStyle: storage.forcePathStyle ?? false,
});

export const logServerConfig = (config: BrowserHiveConfig): void => {
  const coordinator = config.coordinator;
  const capture = coordinator.browserProfiles[0]?.capture ?? DEFAULT_CAPTURE_CONFIG;

  logger.info(
    {
      port: config.http.port,
      tls: config.http.tls
        ? { enabled: true, certPath: config.http.tls.certPath }
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
      resetPageState: capture.resetPageState,
      ...(capture.wacz && {
        wacz: {
          maxResponseBytes: capture.wacz.maxResponseBytes,
          maxTaskBytes: capture.wacz.maxTaskBytes,
          maxPendingRequests: capture.wacz.maxPendingRequests,
          blockUrlPatternCount: capture.wacz.blockUrlPatterns.length,
          skipContentTypes: capture.wacz.skipContentTypes,
          software: capture.wacz.software,
        },
      }),
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
  const server = new HttpServer(coordinator, config.http);

  await server.initialize();
  await server.start();

  return {
    shutdown: async (): Promise<void> => {
      logger.info("Received shutdown signal");
      await server.shutdown();
    },
  };
};
