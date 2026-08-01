/**
 * Reading capture artefacts back out of the object store.
 *
 * The rest of this suite talks HTTP only, on the grounds that a black-box test
 * should see what a client sees. S3 is the one place that rule bends, and it
 * bends deliberately: browserhive PUTs artefacts with a signed request, so a
 * test that GETs them the same way exercises the credentials and the bucket
 * policy too. Opening an anonymous read path instead would make those two
 * unobservable — the store would answer even if every credential were wrong.
 *
 * Nothing here imports browserhive source. The S3 protocol and the WACZ layout
 * are contracts, not internals.
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";
import { unzipSync } from "fflate";

/**
 * The fixed development identity, spelled the same way in docker-compose.yml
 * for both seaweedfs and browserhive. Hard-coded rather than read from the
 * environment: a test pointed at a store it cannot authenticate against should
 * fail loudly here, not silently read someone else's bucket.
 */
const CREDENTIALS = { accessKeyId: "browserhive", secretAccessKey: "browserhive" };

/**
 * `forcePathStyle` is not optional — SeaweedFS serves `<endpoint>/<bucket>/<key>`
 * and does not resolve the virtual-host form the SDK prefers by default.
 */
export const makeS3 = (endpoint: string): S3Client =>
  new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: CREDENTIALS,
  });

/** Split the `s3://<bucket>/<key>` location the API reports for an artefact. */
export const parseS3Uri = (uri: string): { bucket: string; key: string } => {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (match === null) throw new Error(`not an s3 uri: ${uri}`);
  return { bucket: match[1]!, key: match[2]! };
};

/** Download one artefact whole. Artefacts are small enough not to stream. */
export async function fetchArtifact(s3: S3Client, uri: string): Promise<Buffer> {
  const { bucket, key } = parseS3Uri(uri);
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (out.Body === undefined) throw new Error(`empty body: ${uri}`);
  return Buffer.from(await out.Body.transformToByteArray());
}

/** Entry name → bytes, for a WACZ that has already been downloaded. */
export type WaczEntries = Record<string, Uint8Array>;

export const openWacz = (bytes: Buffer): WaczEntries => unzipSync(new Uint8Array(bytes));

const entry = (entries: WaczEntries, name: string): Uint8Array => {
  const found = entries[name];
  if (found === undefined) {
    throw new Error(`WACZ has no ${name} (entries: ${Object.keys(entries).sort().join(", ")})`);
  }
  return found;
};

/**
 * The whole WARC as one string, decoded as latin1.
 *
 * A WARC interleaves text headers with response bodies that are arbitrary
 * bytes. Decoding as utf-8 replaces every invalid sequence with U+FFFD, which
 * both corrupts the payloads and shifts every offset after them; latin1 is a
 * total byte↔char mapping, so header matching stays exact.
 */
export const warcText = (entries: WaczEntries): string =>
  gunzipSync(Buffer.from(entry(entries, "archive/data.warc.gz"))).toString("latin1");

/** `datapackage.json`, parsed. */
export const datapackage = (entries: WaczEntries): Record<string, unknown> =>
  JSON.parse(Buffer.from(entry(entries, "datapackage.json")).toString("utf-8")) as Record<
    string,
    unknown
  >;

/**
 * The JSON object from each CDXJ line.
 *
 * A line is `<surt> <timestamp> <json>`, and the SURT itself may contain
 * spaces-free but brace-free text, so the payload is taken from the first `{`
 * rather than by splitting on whitespace.
 */
export const cdxjEntries = (entries: WaczEntries): Record<string, unknown>[] =>
  Buffer.from(entry(entries, "indexes/index.cdxj"))
    .toString("utf-8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>);
