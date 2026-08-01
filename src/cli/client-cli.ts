/**
 * Client CLI
 *
 * CLI logic for the HTTP capture client. `--server` and `--tls-ca-cert`
 * fall back to `BROWSERHIVE_SERVER` / `BROWSERHIVE_TLS_CA_CERT` when not
 * given on the command line. Per-job flags (`--data`, `--png`, `--webp`,
 * `--html`, `--limit`, `--dismiss-banners`) intentionally have no env
 * equivalents — they are caller-side intent, not deployment configuration.
 *
 * `--server` has no commander-level default. When omitted, the generated
 * SDK falls back to its built-in baseUrl (extracted from `servers[0].url`
 * in openapi.yaml at generation time), keeping the spec as the single
 * source of truth for the default address.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { type CaptureFormats } from "../capture/index.js";
import type { ArchiveMode } from "../config/index.js";
import { logger } from "../logger.js";

export interface ClientOptions {
  server?: string;
  data: string;
  png?: boolean;
  webp?: boolean;
  html?: boolean;
  links?: boolean;
  mhtml?: boolean;
  /** Record the full HTTP session as a WACZ archive (replay via ReplayWeb.page). */
  wacz?: boolean;
  limit?: number;
  tlsCaCert?: string;
  dismissBanners?: boolean;
  acceptLanguage?: string;
  /**
   * When set together with `viewportHeight`, sent as the request's
   * `viewport` field so the server overrides its own default for this
   * request only. Both must be provided to take effect — a single
   * dimension is not meaningful and is rejected at parse time.
   */
  viewportWidth?: number;
  viewportHeight?: number;
  /**
   * When set, sent as the request's `deviceScaleFactor` so the server captures
   * at that DPR — e.g. `2` for a Retina-faithful WACZ (the page then fetches
   * the `2x` responsive-image candidates). Omitted → server default (1).
   */
  deviceScaleFactor?: number;
  /**
   * When set, sent as the request's `operationDelayMs`: the server paces each
   * browser operation by this many ms for that one capture, so a headless run
   * can be watched live. Not puppeteer's `slowMo` — see capture/capture-page.ts.
   */
  operationDelayMs?: number;
  /**
   * When set, sent as the request's `archiveMode`. `"multipass"` makes the
   * server load the page once per device pixel ratio into one WACZ, with the
   * browser cache disabled. Omitted → server default (`single-pass`).
   */
  archiveMode?: ArchiveMode;
  /**
   * When `true`, sent as the request's `fullPage: true` to extend
   * PNG / WebP screenshots beyond the viewport. Omitted when the flag
   * is absent so the server-side default applies.
   */
  fullPage?: boolean;
  /**
   * When `true`, sent as the request's `signing: true` — ask the server's
   * signing service for a wacz-auth signature.
   *
   * Only valid together with `--wacz`; the server rejects the other
   * combination rather than accepting a request it cannot satisfy. A capture
   * whose signature fails still succeeds, so check `signature.signed` on the
   * result to tell a signed archive from an unsigned one.
   */
  signing?: boolean;
  /**
   * Which `examples/behaviors/<version>/` directory to load client-supplied
   * custom behaviors from. Attached per-entry by matching the target URL's
   * host (FQDN then registrable domain). Defaults to `v1.0`.
   */
  behaviorsVersion?: string;
}

const parsePositiveInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new InvalidArgumentError("Must be a positive integer");
  }
  return num;
};

// Reject empty / whitespace-only values up front; length and printable-ASCII
// constraints are enforced server-side by Ajv via the OpenAPI schema
// (`minLength:1` / `maxLength:200` / `pattern:^[\x20-\x7e]+$`).
/** Like `parsePositiveInt` but admits `0` — the "off" value for delays. */
const parseNonNegativeInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new InvalidArgumentError("Must be a non-negative integer");
  }
  return num;
};

const parseNonEmpty = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new InvalidArgumentError("Must be a non-empty string");
  }
  return trimmed;
};

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name("browserhive-example")
    .description("HTTP Capture Submitter - Submit capture requests from a YAML data file (fire-and-forget)")
    .requiredOption("--data <path>", "YAML data file path")
    .addOption(
      new Option(
        "--server <url>",
        "HTTP server base URL. Defaults to the SDK's baked-in baseUrl (servers[0].url in openapi.yaml).",
      ).env("BROWSERHIVE_SERVER"),
    )
    .option("--png", "Capture PNG screenshot")
    .option("--webp", "Capture WebP screenshot")
    .option("--html", "Capture HTML")
    .option("--links", "Extract <a href> links to a .links.json file")
    .option(
      "--mhtml",
      "Capture as MHTML single-file archive (CDP Page.captureSnapshot)",
    )
    .option(
      "--wacz",
      "Record the entire HTTP session as a WACZ archive (replay via ReplayWeb.page)",
    )
    .addOption(
      new Option("--limit <n>", "Maximum number of entries to read from the data file")
        .argParser(parsePositiveInt),
    )
    .option(
      "--dismiss-banners",
      "Run banner / modal dismissal before capturing (best-effort)",
    )
    .addOption(
      new Option(
        "--accept-language <bcp47>",
        'Accept-Language header to forward upstream for every entry (e.g. "ja-JP,ja;q=0.9,en;q=0.8")',
      ).argParser(parseNonEmpty),
    )
    .addOption(
      new Option(
        "--viewport-width <px>",
        "Per-request viewport width (must be paired with --viewport-height; overrides the server default)",
      ).argParser(parsePositiveInt),
    )
    .addOption(
      new Option(
        "--viewport-height <px>",
        "Per-request viewport height (must be paired with --viewport-width; overrides the server default)",
      ).argParser(parsePositiveInt),
    )
    .addOption(
      new Option(
        "--operation-delay-ms <ms>",
        "Per-request delay (ms) before each browser operation, so this capture can be watched live via chrome://inspect. 0 = off",
      ).argParser(parseNonNegativeInt),
    )
    .addOption(
      new Option(
        "--archive-mode <mode>",
        "Per-request archive mode: single-pass (default) or multipass (one pass per DPR into a single WACZ, browser cache disabled)",
      ).choices(["single-pass", "multipass"]),
    )
    .addOption(
      new Option(
        "--device-scale-factor <n>",
        "Per-request device pixel ratio (2 = Retina — captures the 2x responsive-image candidates; overrides the server default)",
      ).argParser(parsePositiveInt),
    )
    .option(
      "--full-page",
      "Capture the full document height (overrides the server default for PNG / WebP)",
    )
    .option(
      "--signing",
      "Ask the server's signing service for a wacz-auth signature (requires --wacz). A capture whose signature fails still succeeds — see signature.signed on the result",
    )
    .addOption(
      new Option(
        "--behaviors-version <v>",
        "examples/behaviors/<v>/ directory to load custom behaviors from (matched per-entry by host)",
      ).default("v1.0"),
    )
    .addOption(
      new Option(
        "--tls-ca-cert <path>",
        "CA certificate file path for TLS (enables TLS when specified)",
      ).env("BROWSERHIVE_TLS_CA_CERT"),
    )
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .showHelpAfterError(true);

  return program;
};

export const parseClientOptions = (argv: string[]): ClientOptions => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<{
    data: string;
    server?: string;
    png?: boolean;
    webp?: boolean;
    html?: boolean;
    links?: boolean;
    mhtml?: boolean;
    wacz?: boolean;
    limit?: number;
    tlsCaCert?: string;
    dismissBanners?: boolean;
    acceptLanguage?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    deviceScaleFactor?: number;
    operationDelayMs?: number;
    archiveMode?: ArchiveMode;
    fullPage?: boolean;
    signing?: boolean;
    behaviorsVersion?: string;
  }>();

  if ((opts.viewportWidth === undefined) !== (opts.viewportHeight === undefined)) {
    program.error(
      "--viewport-width and --viewport-height must be specified together",
    );
  }

  return {
    data: opts.data,
    ...(opts.server !== undefined && { server: opts.server }),
    ...(opts.png !== undefined && { png: opts.png }),
    ...(opts.webp !== undefined && { webp: opts.webp }),
    ...(opts.html !== undefined && { html: opts.html }),
    ...(opts.links !== undefined && { links: opts.links }),
    ...(opts.mhtml !== undefined && { mhtml: opts.mhtml }),
    ...(opts.wacz !== undefined && { wacz: opts.wacz }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.tlsCaCert !== undefined && { tlsCaCert: opts.tlsCaCert }),
    ...(opts.dismissBanners !== undefined && { dismissBanners: opts.dismissBanners }),
    ...(opts.acceptLanguage !== undefined && { acceptLanguage: opts.acceptLanguage }),
    ...(opts.viewportWidth !== undefined && { viewportWidth: opts.viewportWidth }),
    ...(opts.viewportHeight !== undefined && { viewportHeight: opts.viewportHeight }),
    ...(opts.deviceScaleFactor !== undefined && { deviceScaleFactor: opts.deviceScaleFactor }),
    ...(opts.operationDelayMs !== undefined && { operationDelayMs: opts.operationDelayMs }),
    ...(opts.archiveMode !== undefined && { archiveMode: opts.archiveMode }),
    ...(opts.fullPage !== undefined && { fullPage: opts.fullPage }),
    ...(opts.signing !== undefined && { signing: opts.signing }),
    ...(opts.behaviorsVersion !== undefined && { behaviorsVersion: opts.behaviorsVersion }),
  };
};

export const getCaptureFormats = (options: ClientOptions): CaptureFormats => {
  return {
    png: options.png ?? false,
    webp: options.webp ?? false,
    html: options.html ?? false,
    links: options.links ?? false,
    mhtml: options.mhtml ?? false,
    wacz: options.wacz ?? false,
  };
};

export const logClientConfig = (options: ClientOptions): void => {
  const viewport =
    options.viewportWidth !== undefined && options.viewportHeight !== undefined
      ? { width: options.viewportWidth, height: options.viewportHeight }
      : null;
  logger.info(
    {
      server: options.server ?? "(SDK default)",
      tls: options.tlsCaCert
        ? { enabled: true, caCertPath: options.tlsCaCert }
        : { enabled: false },
      data: options.data,
      captureFormats: getCaptureFormats(options),
      dismissBanners: options.dismissBanners ?? false,
      acceptLanguage: options.acceptLanguage ?? null,
      viewport,
      deviceScaleFactor: options.deviceScaleFactor ?? null,
      operationDelayMs: options.operationDelayMs ?? "(server default)",
      archiveMode: options.archiveMode ?? "(server default)",
      fullPage: options.fullPage ?? null,
      signing: options.signing ?? null,
      limit: options.limit ?? null,
      behaviorsVersion: options.behaviorsVersion ?? "v1.0",
    },
    "Client configuration",
  );
};
