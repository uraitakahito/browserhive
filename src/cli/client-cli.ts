/**
 * Client CLI
 *
 * CLI logic for the gRPC capture client.
 */
import { Command, InvalidArgumentError } from "commander";
import { type CaptureOptions } from "../capture/index.js";
import { logger } from "../logger.js";

export interface ClientOptions {
  server: string;
  csv: string;
  png?: boolean;
  jpeg?: boolean;
  html?: boolean;
  limit?: number;
  tlsCaCert?: string;
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
    .description("gRPC Capture Submitter - Submit capture requests from CSV (fire-and-forget)")
    .requiredOption("--csv <path>", "CSV file path")
    .option(
      "--server <host:port>",
      "gRPC server address (default: localhost:50051)",
      "localhost:50051"
    )
    .option(
      "--png",
      "Capture PNG screenshot"
    )
    .option(
      "--jpeg",
      "Capture JPEG screenshot"
    )
    .option(
      "--html",
      "Capture HTML"
    )
    .option(
      "--limit <n>",
      "Maximum number of URLs to read from CSV",
      parsePositiveInt
    )
    .option(
      "--tls-ca-cert <path>",
      "CA certificate file path for TLS (enables TLS when specified)"
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
  }>();

  return {
    server: opts.server,
    csv: opts.csv,
    ...(opts.png !== undefined && { png: opts.png }),
    ...(opts.jpeg !== undefined && { jpeg: opts.jpeg }),
    ...(opts.html !== undefined && { html: opts.html }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.tlsCaCert !== undefined && { tlsCaCert: opts.tlsCaCert }),
  };
};

export const getCaptureOptions = (options: ClientOptions): CaptureOptions => {
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
      captureOptions: getCaptureOptions(options),
      limit: options.limit ?? null,
    },
    "Client configuration"
  );
};
