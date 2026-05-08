/**
 * WaczPackager — assembles a ReplayWeb.page-compatible WACZ zip from a
 * Phase-2 WARC.gz plus the per-response metadata `NetworkRecorder.stop()`
 * returns.
 *
 * Produced layout:
 *
 *   {output}.wacz (zip)
 *   ├── archive/data.warc.gz       ← the WARC file produced by NetworkRecorder
 *   ├── pages/pages.jsonl          ← single-page header + 1 entry
 *   ├── indexes/index.cdxj         ← plain CDXJ (NOT gzipped — wabac.js doesn't recognise .cdx.gz)
 *   ├── fuzzy.json                 ← cache-buster strip rules
 *   └── datapackage.json           ← integrity metadata + profile/version
 *
 * The packager is intentionally synchronous in shape (build → write →
 * close) — every byte of every entry is computed up-front so the
 * `datapackage.json` can carry their hashes. For typical capture sizes
 * (tens of MB), in-memory packaging is fine; if we ever need streaming
 * for multi-GB captures, the resource hashes can be computed from the
 * source files on disk and the zip can stream from those file handles.
 */
import { Buffer } from "node:buffer";
import { createWriteStream, readFile } from "node:fs";
import { stat } from "node:fs/promises";
import archiver from "archiver";
import type { RecordedResponse } from "../../capture/network-recorder-types.js";
import { buildCdxjIndex } from "./cdxj.js";
import { buildPagesJsonl } from "./pages.js";
import {
  buildDatapackage,
  serializeDatapackage,
} from "./datapackage.js";
import { buildFuzzyJson } from "./fuzzy.js";

/** WACZ zip entry path of the inlined WARC. */
const WARC_ENTRY_PATH = "archive/data.warc.gz";
/**
 * `filename` value for CDXJ entries. Per WACZ spec / wacz-creator
 * convention this is the WARC name **relative to the `archive/`
 * subdirectory** — wabac.js prepends `archive/` itself when it goes to
 * fetch the bytes. Writing the full `archive/data.warc.gz` here causes a
 * 404 in ReplayWeb.page because wabac looks for `archive/archive/data.warc.gz`.
 */
const WARC_FILENAME_FOR_CDX = "data.warc.gz";
const PAGES_ENTRY_PATH = "pages/pages.jsonl";
/**
 * Plain (un-gzipped) CDXJ index. wabac.js's `loadIndex` only recognises
 * files ending in `.cdx`, `.cdxj`, or `.idx` — `.cdx.gz` / `.cdxj.gz`
 * are silently skipped, which makes every URL lookup produce
 * "Archived Page Not Found" even when the WACZ otherwise loads
 * correctly. Source: https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts
 * (the `loadIndex` method's `endsWith(".cdx") || endsWith(".cdxj")`
 * branch). The index is small enough that dropping gzip is fine; the
 * surrounding zip's deflate compression covers the size concern.
 */
const INDEX_ENTRY_PATH = "indexes/index.cdxj";
const DATAPACKAGE_ENTRY_PATH = "datapackage.json";
const FUZZY_ENTRY_PATH = "fuzzy.json";

export interface WaczPackageInput {
  /** Path to the source `.warc.gz` (from `NetworkRecorder.stop().path`). */
  warcPath: string;
  /** Output `.wacz` path. */
  waczPath: string;
  /** Page-list entry id. Use the task id for cross-referencing logs. */
  taskId: string;
  /** Primary capture URL (the one the task asked to capture). */
  pageUrl: string;
  /** `<title>` of the captured page (may be empty). */
  pageTitle: string;
  /** ISO 8601 timestamp of the capture (used as page `ts` AND `mainPageDate`). */
  capturedAt: string;
  /** Software identifier embedded in `datapackage.json`. */
  software: string;
  /** Per-response WARC metadata for the CDXJ index. */
  responses: RecordedResponse[];
  /**
   * Query parameter names to embed in `fuzzy.json` as strip rules. When
   * empty / omitted the file is still emitted (with empty `rules`) so the
   * WACZ structure stays uniform across deployments.
   */
  fuzzyParams?: readonly string[];
}

export interface WaczPackageResult {
  path: string;
  bytes: number;
}

/**
 * Read the WARC file once and return its bytes. Small enough for
 * production capture sizes (per-task cap ≤ 200 MB). If we ever need to
 * stream, the zip layer (`archiver`) can take a `ReadStream` directly —
 * we'd have to compute the file hash separately for the datapackage
 * before streaming.
 */
const readFileBytes = (path: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    readFile(path, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

/**
 * Build a WACZ zip from a finished WARC plus per-response metadata.
 * Returns the output path + total size on disk. Implemented as a free
 * function rather than a static-only class so the eslint
 * `no-extraneous-class` rule passes — the unit of code here is the
 * pipeline, not an instance.
 */
export const packWacz = async (
  input: WaczPackageInput,
): Promise<WaczPackageResult> => {
  // 1. Build each resource as bytes so we can hash them for datapackage.
  const warcBytes = await readFileBytes(input.warcPath);
  const pagesBytes = Buffer.from(
    buildPagesJsonl([
      {
        id: input.taskId,
        url: input.pageUrl,
        ts: input.capturedAt,
        title: input.pageTitle,
      },
    ]),
    "utf-8",
  );
  const cdxjText = buildCdxjIndex(WARC_FILENAME_FOR_CDX, input.responses);
  // Plain text — wabac.js doesn't recognise `.cdx.gz` / `.cdxj.gz`.
  // The outer zip's deflate compression handles size.
  const indexBytes = Buffer.from(cdxjText, "utf-8");
  const fuzzyBytes = buildFuzzyJson({ params: input.fuzzyParams ?? [] });

  // 2. Assemble datapackage.json — its hashes cover the OTHER resources,
  // not itself, so build it before serializing.
  const datapackage = buildDatapackage({
    software: input.software,
    created: new Date().toISOString(),
    mainPageURL: input.pageUrl,
    mainPageDate: input.capturedAt,
    title: input.pageTitle === "" ? input.pageUrl : input.pageTitle,
    name: `browserhive-${input.taskId}`,
    resources: [
      { path: WARC_ENTRY_PATH, bytes: warcBytes },
      { path: PAGES_ENTRY_PATH, bytes: pagesBytes },
      { path: INDEX_ENTRY_PATH, bytes: indexBytes },
      { path: FUZZY_ENTRY_PATH, bytes: fuzzyBytes },
    ],
  });
  const datapackageBytes = serializeDatapackage(datapackage);

  // 3. Write the zip. Use STORE for the inner WARC.gz (already gzipped —
  // double-compressing would only inflate). Other entries default to DEFLATE.
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(input.waczPath);
    const zip = archiver("zip", { zlib: { level: 6 } });

    output.on("close", () => {
      resolve();
    });
    output.on("error", reject);
    zip.on("error", reject);
    zip.on("warning", (err: Error & { code?: string }) => {
      // archiver emits ENOENT etc. as warnings; treat any warning as fatal here.
      reject(err);
    });

    zip.pipe(output);
    zip.append(warcBytes, { name: WARC_ENTRY_PATH, store: true });
    zip.append(pagesBytes, { name: PAGES_ENTRY_PATH });
    zip.append(indexBytes, { name: INDEX_ENTRY_PATH });
    zip.append(fuzzyBytes, { name: FUZZY_ENTRY_PATH });
    zip.append(datapackageBytes, { name: DATAPACKAGE_ENTRY_PATH });
    void zip.finalize();
  });

  const stats = await stat(input.waczPath);
  return { path: input.waczPath, bytes: stats.size };
};

/**
 * Static facade kept for ergonomic call sites (`WaczPackager.pack(...)`).
 * Delegates straight to `packWacz`. The PascalCase identifier is
 * intentional — it reads as a "namespace" rather than a regular value
 * import.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const WaczPackager = {
  pack: packWacz,
};
