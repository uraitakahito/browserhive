/**
 * WACZ Packager — turns the WARC.gz produced by `NetworkRecorder` into a
 * ReplayWeb.page-compatible `.wacz` archive. See `packager.ts` for the
 * end-to-end flow.
 */
export { WaczPackager } from "./packager.js";
export type {
  WaczPackageInput,
  WaczPackageResult,
} from "./packager.js";

export { surtUrl, isoToCdxTimestamp, buildCdxjIndex, buildCdxjLine } from "./cdxj.js";
export type { CdxjLineInput } from "./cdxj.js";

export { buildPagesJsonl } from "./pages.js";
export type { PagesLineInput } from "./pages.js";

export {
  buildDatapackage,
  serializeDatapackage,
} from "./datapackage.js";
export type {
  DatapackageInput,
  DatapackageOutput,
  WaczResourceInput,
} from "./datapackage.js";

export { buildFuzzyJson } from "./fuzzy.js";
export type { FuzzyJsonInput, FuzzyRule } from "./fuzzy.js";

export { analyzeCompleteness } from "./completeness.js";
export type { CompletenessReport } from "./completeness.js";

export { readTrustAnchors, verifySignedData } from "./verify-signed-data.js";
export type {
  CheckOutcome,
  TrustAnchors,
  VerificationChecks,
} from "./verify-signed-data.js";
export {
  SigningRequiredError,
  createHttpSigner,
  noSigningServiceSigner,
  unsignedSigner,
} from "./signer.js";
export type {
  HttpSignerOptions,
  SignatureReport,
  SignResult,
  WaczSigner,
} from "./signer.js";
