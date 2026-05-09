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
   * When `true`, sent as the request's `fullPage: true` to extend
   * PNG / WebP screenshots beyond the viewport. Omitted when the flag
   * is absent so the server-side default applies.
   */
  fullPage?: boolean;
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
    .option(
      "--full-page",
      "Capture the full document height (overrides the server default for PNG / WebP)",
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
    fullPage?: boolean;
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
    ...(opts.fullPage !== undefined && { fullPage: opts.fullPage }),
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
      fullPage: options.fullPage ?? null,
      limit: options.limit ?? null,
    },
    "Client configuration",
  );
};
