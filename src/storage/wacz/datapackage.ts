/**
 * `datapackage.json` builder for WACZ — a Frictionless Data spec
 * descriptor that names every file in the WACZ along with its hash and
 * size. ReplayWeb.page uses this for integrity verification and to know
 * which resources are present.
 *
 * Hash format: `sha256:<hex>` (the WACZ spec). Distinct from WARC's
 * digest format (`sha256:<base32>`) — see `digest.ts:sha256Hex`.
 */
import { sha256Hex } from "../warc/digest.js";

export interface WaczResourceInput {
  /** zip entry path, e.g. `archive/data.warc.gz`. */
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
  return out;
};

/** Stable JSON serialization (2-space indent) so byte-equal builds reproduce. */
export const serializeDatapackage = (pkg: DatapackageOutput): Buffer =>
  Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
