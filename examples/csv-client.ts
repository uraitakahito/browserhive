#!/usr/bin/env npx tsx
/**
 * Sample client that sends capture requests from a CSV file.
 */
import { readFile } from "node:fs/promises";
import { CaptureSubmitter, type CaptureRequest, type CaptureAcceptance } from "../src/grpc/client.js";
import {
  parseClientOptions,
  logClientConfig,
  getCaptureOptions,
  type ClientOptions,
} from "../src/cli/client-cli.js";
import type { ClientTlsConfig } from "../src/config/types.js";
import { captureOptionsToProto, type CaptureOptions } from "../src/capture/index.js";
import { logger } from "../src/logger.js";

/** Labels separator in CSV file (pipe character) */
const LABELS_CSV_SEPARATOR = "|";

interface CsvRecord {
  labels: string[];
  url: string;
}

interface SubmitResult {
  taskId: string;
  correlationId: string;
  labels: string[];
  accepted: boolean;
  error?: string;
}

const generateRandomId = (length: number): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const parseCsv = (content: string): CsvRecord[] => {
  const lines = content.split("\n");
  const records: CsvRecord[] = [];

  // Skip first line (header row)
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(",");
    if (parts.length < 2) continue;

    const labelsRaw = parts[0]?.trim() ?? "";
    const url = parts.slice(1).join(",").trim();

    if (!url) continue;

    const labels = labelsRaw
      ? labelsRaw.split(LABELS_CSV_SEPARATOR).map((l) => l.trim()).filter((l) => l)
      : [];
    // Allow empty labels
    records.push({ labels, url });
  }

  return records;
};

/**
 * Submit a single capture request (fire-and-forget)
 *
 * Returns whether the request was accepted, not whether the capture succeeded.
 */
const submitRequest = async (
  submitter: CaptureSubmitter,
  record: CsvRecord,
  captureOptions: CaptureOptions
): Promise<SubmitResult> => {
  const correlationId = generateRandomId(5);

  /* eslint-disable @typescript-eslint/naming-convention */
  const request: CaptureRequest = {
    url: record.url,
    labels: record.labels,
    correlation_id: correlationId,
    capture_options: captureOptionsToProto(captureOptions),
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  try {
    const response: CaptureAcceptance = await submitter.submit(request);
    return {
      taskId: response.task_id,
      correlationId,
      labels: record.labels,
      accepted: response.accepted,
      ...(response.error !== undefined && { error: response.error }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      taskId: "",
      correlationId,
      labels: record.labels,
      accepted: false,
      error: errorMessage,
    };
  }
};

const submitAll = async (
  submitter: CaptureSubmitter,
  records: CsvRecord[],
  captureOptions: CaptureOptions
): Promise<SubmitResult[]> => {
  const total = records.length;
  let completed = 0;

  const promises = records.map(async (record) => {
    const result = await submitRequest(submitter, record, captureOptions);
    completed++;

    if (result.accepted) {
      logger.info(
        { progress: `${String(completed)}/${String(total)}`, taskId: result.taskId, correlationId: result.correlationId, labels: result.labels },
        "Request accepted"
      );
    } else {
      logger.warn(
        { progress: `${String(completed)}/${String(total)}`, taskId: result.taskId, correlationId: result.correlationId, labels: result.labels, error: result.error ?? "Unknown error" },
        "Request rejected"
      );
    }

    return result;
  });

  return Promise.all(promises);
};

const logSummary = (results: SubmitResult[], totalDuration: number): void => {
  const acceptedCount = results.filter((r) => r.accepted).length;
  const rejectedCount = results.filter((r) => !r.accepted).length;

  logger.info(
    {
      total: results.length,
      accepted: acceptedCount,
      rejected: rejectedCount,
      durationMs: totalDuration,
    },
    "Request summary"
  );
};

const buildTlsConfig = (options: ClientOptions): ClientTlsConfig | undefined => {
  if (options.tlsCaCert) {
    return {
      enabled: true,
      caCertPath: options.tlsCaCert,
    };
  }
  return undefined;
};

const runClient = async (options: ClientOptions): Promise<void> => {
  const startTime = Date.now();

  logClientConfig(options);

  const csvContent = await readFile(options.csv, "utf-8");
  let records = parseCsv(csvContent);
  const totalInCsv = records.length;

  if (options.limit !== undefined && options.limit > 0) {
    records = records.slice(0, options.limit);
  }

  logger.info({ count: records.length, total: totalInCsv }, "Loaded URLs from CSV");

  if (records.length === 0) {
    logger.info("No URLs to process");
    return;
  }

  const tlsConfig = buildTlsConfig(options);
  const submitter = new CaptureSubmitter(options.server, tlsConfig);
  submitter.connect();

  try {
    const captureOptions = getCaptureOptions(options);
    const results = await submitAll(
      submitter,
      records,
      captureOptions
    );

    const totalDuration = Date.now() - startTime;
    logSummary(results, totalDuration);
  } finally {
    submitter.close();
  }
};

const main = async (): Promise<void> => {
  const options = parseClientOptions(process.argv);
  await runClient(options);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
