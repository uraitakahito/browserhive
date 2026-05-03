/**
 * Sample client that submits capture requests from a CSV file (fire-and-forget).
 *
 * Uses openapi-fetch with the types generated from src/http/openapi.yaml,
 * so request and response shapes are fully type-checked against the spec.
 */
import { readFile } from "node:fs/promises";
import createClient from "openapi-fetch";
import {
  parseClientOptions,
  logClientConfig,
  getCaptureFormats,
  type ClientOptions,
} from "../src/cli/client-cli.js";
import type { CaptureFormats } from "../src/capture/index.js";
import type { paths, components } from "../src/http/generated/types.js";
import { logger } from "../src/logger.js";

type CaptureRequest = components["schemas"]["CaptureRequest"];
type Problem = components["schemas"]["Problem"];

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
    records.push({ labels, url });
  }

  return records;
};

type Client = ReturnType<typeof createClient<paths>>;

/**
 * For TLS server verification with a custom CA, set the
 * `NODE_EXTRA_CA_CERTS` env var to the CA certificate path before
 * starting the process. The `--tls-ca-cert` flag below is logged for
 * visibility but is otherwise informational — Node's global fetch picks
 * up the trust anchor from the env var.
 */
const buildClient = (options: ClientOptions): Client =>
  createClient<paths>({ baseUrl: options.server });

const submitRequest = async (
  client: Client,
  record: CsvRecord,
  captureFormats: CaptureFormats,
  dismissBanners: boolean,
): Promise<SubmitResult> => {
  const correlationId = generateRandomId(5);
  const body: CaptureRequest = {
    url: record.url,
    labels: record.labels,
    correlationId,
    captureFormats,
    dismissBanners,
  };

  try {
    const { data, error, response } = await client.POST("/v1/captures", {
      body,
    });
    if (response.status === 202 && data) {
      return {
        taskId: data.taskId,
        correlationId,
        labels: record.labels,
        accepted: true,
      };
    }
    const problem: Problem | undefined = error;
    const message = problem?.detail ?? problem?.title ?? `HTTP ${String(response.status)}`;
    return {
      taskId: "",
      correlationId,
      labels: record.labels,
      accepted: false,
      error: message,
    };
  } catch (caught) {
    const errorMessage = caught instanceof Error ? caught.message : String(caught);
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
  client: Client,
  records: CsvRecord[],
  captureFormats: CaptureFormats,
  dismissBanners: boolean,
): Promise<SubmitResult[]> => {
  const total = records.length;
  let completed = 0;

  const promises = records.map(async (record) => {
    const result = await submitRequest(client, record, captureFormats, dismissBanners);
    completed++;

    if (result.accepted) {
      logger.info(
        { progress: `${String(completed)}/${String(total)}`, taskId: result.taskId, correlationId: result.correlationId, labels: result.labels },
        "Request accepted",
      );
    } else {
      logger.warn(
        { progress: `${String(completed)}/${String(total)}`, taskId: result.taskId, correlationId: result.correlationId, labels: result.labels, error: result.error ?? "Unknown error" },
        "Request rejected",
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
    "Request summary",
  );
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

  const client = buildClient(options);
  const captureFormats = getCaptureFormats(options);
  const results = await submitAll(
    client,
    records,
    captureFormats,
    options.dismissBanners ?? false,
  );

  const totalDuration = Date.now() - startTime;
  logSummary(results, totalDuration);
};

const main = async (): Promise<void> => {
  const options = parseClientOptions(process.argv);
  await runClient(options);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
