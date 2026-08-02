/**
 * `datapackage.json` builder for WACZ — a Frictionless Data spec
 * descriptor that names every file in the WACZ along with its hash and
 * size. ReplayWeb.page uses this for integrity verification and to know
 * which resources are present.
 *
 * Hash format: `sha256:<hex>` (the WACZ spec). Distinct from WARC's
 * digest format (`sha256:<base32>`) — see `digest.ts:sha256Hex`.
 */
import type { CompletenessReport } from "./completeness.js";
import type { CoverageReport } from "./coverage.js";
import type { ObservedTlsByHost } from "../../capture/network-recorder-types.js";
import { sha256Hex } from "../warc/digest.js";

export interface WaczResourceInput {
  /** ZIP entry path, e.g. `archive/data.warc.gz`. */
  path: string;
  /** Raw bytes of the entry. */
  bytes: Buffer;
}

export interface DatapackageInput {
  software: string;
  /** ISO 8601. The WACZ as a whole was created at this time. */
  created: string;
  mainPageURL: string;
  /** ISO 8601. The primary page's capture timestamp. */
  mainPageDate: string;
  /** Optional human-readable title. */
  title?: string;
  /** Optional package identifier. Defaults to a synthetic value derived from `mainPageURL`. */
  name?: string;
  resources: WaczResourceInput[];
  /** What this capture could not get. Written under `browserhive:capture`. */
  capture?: CaptureSelfReport;
}

/**
 * The archive's account of its own gaps.
 *
 * Written into `datapackage.json` rather than returned only to the caller,
 * because the archive travels and the API response does not. A WACZ opened in
 * three years is the thing that has to answer "is everything here?", and until
 * now it could not — `completeness` was computed on every capture and put in
 * the HTTP response alone, so the moment that response was discarded, the fact
 * that a body was lost to a `304` went with it.
 */
export interface CaptureSelfReport {
  /**
   * Which build produced this archive, in a form a machine can read.
   *
   * `software` beside it is the spec's field and it is prose: py-wacz writes
   * "py-wacz 0.4.6", Browsertrix "Browsertrix-Crawler 1.x (with warcio.js
   * 2.y)", Scoop "Scoop @ Harvard Library Innovation Lab v0.0.1". No two agree
   * on a shape, and nothing parses it — wabac reads only `config`, `profile`,
   * `metadata` and `resources` from this file. So the parseable copy lives
   * here, where the rest of what the capture knows about itself already is.
   */
  build: BuildInfo;
  /** Absent when the browser could not be asked. */
  browser?: { product: string };
  /**
   * The settings that actually applied — not the ones the request carried.
   *
   * Every one of these resolves as `task.X ?? config.X`, so a request that
   * says nothing still gets a value, and writing the request would leave the
   * archive unable to say whether it was captured with the cache cleared or
   * not. What an archive has to answer is what happened.
   */
  settings: CaptureSettings;
  completeness: CompletenessReport;
  /** Absent when behaviors were off, or when autoscroll reported nothing. */
  coverage?: CoverageReport;
  /**
   * What the browser saw of each HTTPS host's TLS connection.
   *
   * Not provenance: a certificate is public, so recording one proves nothing
   * about who answered. It is here because `issuer` shows whether the
   * connection was intercepted and the validity window can be checked against
   * `mainPageDate` — neither of which any other field can answer, and neither
   * of which can be recovered once the capture is over.
   *
   * A host is absent when it was never reached over HTTPS, and `null` when it
   * was but nothing came back.
   */
  tls?: ObservedTlsByHost;
}

/** The build fingerprint, as `scripts/generate-version.mjs` resolves it. */
export interface BuildInfo {
  version: string;
  revision: string;
  buildTime: string;
}

/**
 * What was in force for this capture, limited to things that change the bytes.
 *
 * The line is drawn there on purpose. `taskId` and `correlationId` say who
 * asked; `captureFormats` says which files to emit. Neither changes what is
 * inside the WACZ. `viewport` and `cache` do.
 */
export interface CaptureSettings {
  /**
   * Whether this capture was allowed to go out unsigned.
   *
   * The resolved answer, not the request's flag — a deployment running under
   * `signingPolicy: "required"` signs captures that never asked. Written even
   * when it is `none`, because the absence of `datapackage-digest.json`
   * already says no signature exists and says nothing about whether one was
   * meant to.
   */
  signature: "required" | "none";
  viewport: { width: number; height: number };
  /**
   * One entry per pass. `multipass` sweeps two, and recording a single number
   * for it would tell a reader the 2x variants are absent when they are in the
   * archive. A list keeps the shape the same either way, and says how many
   * passes ran.
   */
  devicePixelRatios: number[];
  cache: string;
  archiveMode: string;
  /**
   * Behaviors that actually ran — `enabled ∩ isMatch()`, taken from the run
   * report rather than from configuration. Site behaviors never appear in
   * `enabled`, so copying the config would miss them.
   */
  behaviors: string[];
  /** Only when the request set one; it changes what the origin returns. */
  acceptLanguage?: string;
}

interface DatapackageResource {
  name: string;
  path: string;
  hash: string;
  bytes: number;
}

export interface DatapackageOutput {
  /**
   * REQUIRED. Per the Frictionless Data Package spec, this is the schema
   * profile identifier; the WACZ 1.1.1 spec mandates the literal value
   * `"data-package"`. Without this field, replay engines (ReplayWeb.page /
   * wabac.js) treat the file as an invalid WACZ and silently fail the CDX
   * lookup, producing the cryptic "Archived Page Not Found" error even
   * when every other resource is correctly populated.
   */
  profile: "data-package";
  // WACZ spec mandates the snake_case `wacz_version` literal — overriding
  // the project's camelCase naming convention here is intentional.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  wacz_version: string;
  name: string;
  software: string;
  created: string;
  mainPageURL: string;
  mainPageDate: string;
  title?: string;
  resources: DatapackageResource[];
  /**
   * Non-spec. What this capture could not get.
   *
   * Namespaced because it is our observation, not a vocabulary anyone agreed
   * on — unlike `wacz_version` and `mainPageURL`, which are bare because the
   * WACZ spec named them. The Frictionless schema has no
   * `additionalProperties: false`, so extra keys are legal by design; wabac.js
   * reads only `config`, `profile`, `metadata` and `resources` from this file
   * and ignores everything else, so replay does not see this at all.
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "browserhive:capture"?: CaptureSelfReport;
}

const fileNameOf = (path: string): string => {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
};

export const buildDatapackage = (input: DatapackageInput): DatapackageOutput => {
  const resources: DatapackageResource[] = input.resources.map((r) => ({
    name: fileNameOf(r.path),
    path: r.path,
    hash: sha256Hex(r.bytes),
    bytes: r.bytes.byteLength,
  }));
  const out: DatapackageOutput = {
    profile: "data-package",
    wacz_version: "1.1.1",
    name: input.name ?? `browserhive-${input.mainPageURL}`,
    software: input.software,
    created: input.created,
    mainPageURL: input.mainPageURL,
    mainPageDate: input.mainPageDate,
    resources,
  };
  if (input.title !== undefined) out.title = input.title;
  if (input.capture !== undefined) out["browserhive:capture"] = input.capture;
  return out;
};

/** Stable JSON serialization (2-space indent) so byte-equal builds reproduce. */
export const serializeDatapackage = (pkg: DatapackageOutput): Buffer =>
  Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
