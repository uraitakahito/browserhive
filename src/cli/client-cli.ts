/**
 * Client CLI
 *
 * CLI logic for the HTTP capture client. `--server` and `--tls-ca-cert`
 * fall back to `BROWSERHIVE_SERVER` / `BROWSERHIVE_TLS_CA_CERT` when not
 * given on the command line. Per-job flags (`--csv`, `--png`, `--jpeg`,
 * `--html`, `--limit`, `--dismiss-banners`) intentionally have no env
 * equivalents — they are caller-side intent, not deployment configuration.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { type CaptureFormats } from "../capture/index.js";
import { DEFAULT_SERVER_ADDRESS } from "../http/generated/server.js";
import { logger } from "../logger.js";

export interface ClientOptions {
  server: string;
  csv: string;
  png?: boolean;
  jpeg?: boolean;
  html?: boolean;
  limit?: number;
  tlsCaCert?: string;
  dismissBanners?: boolean;
}

const parsePositiveInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new InvalidArgumentError("Must be a positive integer");
  }
  return num;
};

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name("browserhive-csv-example")
    .description("HTTP Capture Submitter - Submit capture requests from CSV (fire-and-forget)")
    .requiredOption("--csv <path>", "CSV file path")
    .addOption(
      new Option("--server <url>", "HTTP server base URL (e.g., http://localhost:8080)")
        .env("BROWSERHIVE_SERVER")
        .default(DEFAULT_SERVER_ADDRESS),
    )
    .option("--png", "Capture PNG screenshot")
    .option("--jpeg", "Capture JPEG screenshot")
    .option("--html", "Capture HTML")
    .addOption(
      new Option("--limit <n>", "Maximum number of URLs to read from CSV")
        .argParser(parsePositiveInt),
    )
    .option(
      "--dismiss-banners",
      "Run banner / modal dismissal before capturing (best-effort)",
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
    csv: string;
    server: string;
    png?: boolean;
    jpeg?: boolean;
    html?: boolean;
    limit?: number;
    tlsCaCert?: string;
    dismissBanners?: boolean;
  }>();

  return {
    server: opts.server,
    csv: opts.csv,
    ...(opts.png !== undefined && { png: opts.png }),
    ...(opts.jpeg !== undefined && { jpeg: opts.jpeg }),
    ...(opts.html !== undefined && { html: opts.html }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.tlsCaCert !== undefined && { tlsCaCert: opts.tlsCaCert }),
    ...(opts.dismissBanners !== undefined && { dismissBanners: opts.dismissBanners }),
  };
};

export const getCaptureFormats = (options: ClientOptions): CaptureFormats => {
  return {
    png: options.png ?? false,
    jpeg: options.jpeg ?? false,
    html: options.html ?? false,
  };
};

export const logClientConfig = (options: ClientOptions): void => {
  logger.info(
    {
      server: options.server,
      tls: options.tlsCaCert
        ? { enabled: true, caCertPath: options.tlsCaCert }
        : { enabled: false },
      csv: options.csv,
      captureFormats: getCaptureFormats(options),
      dismissBanners: options.dismissBanners ?? false,
      limit: options.limit ?? null,
    },
    "Client configuration",
  );
};
