/**
 * WARC 1.1 writer + record builders. See `writer.ts` for the gzip
 * concatenation contract and `builders.ts` for the per-record-type helpers.
 */
export type {
  HttpHeader,
  HttpRequestBytesInput,
  HttpResponseBytesInput,
  WarcRecord,
  WarcRecordType,
} from "./types.js";

export { base32Encode, sha256Base32, sha1Base32, sha256Hex } from "./digest.js";

export {
  WARC_VERSION,
  WarcWriter,
  serializeWarcRecord,
} from "./writer.js";

export type { WarcRecordWriteInfo } from "./writer.js";

export {
  newRecordId,
  cdpHeadersToList,
  buildHttpRequestBytes,
  buildHttpResponseBytes,
  buildWarcInfoRecord,
  buildRequestRecord,
  buildResponseRecord,
  buildMetadataRecord,
} from "./builders.js";

export type {
  BuildWarcInfoInput,
  BuildMetadataInput,
} from "./builders.js";
