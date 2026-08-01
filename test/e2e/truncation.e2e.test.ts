/**
 * Truncation E2E: drive a response past `maxResponseBytes` with a real browser
 * and read back what the WACZ says about it.
 *
 * The unit tests reach the same branch by declaring `encodedDataLength`
 * themselves, which can only ever prove what the recorder does with a number it
 * was handed. Whether Chromium reports a number over the cap for a genuinely
 * oversized response — and what it reports elsewhere for the same response — is
 * only observable from out here. That difference is not hypothetical: the size
 * recorded in the metadata record turned out to be the wrong one, and no unit
 * test could have shown it, because they set both values from one constant.
 *
 * `meadow`'s `/large-body` exists for exactly this and had no callers.
 */
import { describe, expect, inject, it } from "vitest";
import { scenarios } from "meadow";

import { captureRequest, submitAndWait, WACZ_ONLY, type Annotate } from "./helpers/capture.js";
import { cdxjEntries, fetchArtifact, makeS3, openWacz, warcText } from "./helpers/artifact.js";

const api = inject("api");
const meadow = inject("meadow");
const s3 = makeS3(inject("s3"));

/**
 * One MiB over the 20 MiB default. Deliberately the smallest body that trips
 * the cap: the point is which branch runs, and every extra megabyte is time
 * spent moving bytes that no assertion looks at.
 *
 * meadow serves this uncompressed (it registers no compression plugin), so the
 * pre-fetch check on `encodedDataLength` is what fires. Were that to change,
 * the post-fetch check on the decoded length would catch it instead and these
 * assertions would still hold.
 */
const OVERSIZED_BYTES = 21 * 1024 * 1024;
const CAP_BYTES = 20 * 1024 * 1024;

interface Archive {
  warc: string;
  cdxj: Record<string, unknown>[];
}

let pending: Promise<Archive> | undefined;

/**
 * One capture for the whole file, started by whichever test asks first.
 *
 * Moving 21 MiB through a real browser costs ~20s and every assertion here is
 * about the same archive, so it runs once. Lazily rather than in `beforeAll`
 * because `submitAndWait` requires a test's `annotate` — it records the taskId,
 * which is the only thread back to the server's own log, and a hook has no test
 * to take it from.
 */
const oversizedCapture = (annotate: Annotate): Promise<Archive> => {
  pending ??= (async (): Promise<Archive> => {
    const url = meadow + scenarios.largeBody(OVERSIZED_BYTES);
    const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);
    expect(report.status).toBe("success");

    const entries = openWacz(await fetchArtifact(s3, report.artifacts.wacz!));
    return { warc: warcText(entries), cdxj: cdxjEntries(entries) };
  })();
  return pending;
};

/** The `key: value` body of the metadata record that reports the truncation. */
const metadataField = (warc: string, name: string): string | undefined =>
  new RegExp(`^${name}: (.*)$`, "m").exec(warc)?.[1];

describe("a response over maxResponseBytes", () => {
  it("is dropped and recorded as a truncation", async ({ annotate }) => {
    const { warc } = await oversizedCapture(annotate);
    // Asserted on its own so that a regression here cannot hide inside the
    // `it.fails` blocks below — that form passes as long as *something* in it
    // throws, so a broken expectation next to a working one is invisible.
    expect(warc).toContain("truncated: too-large");
  });

  /**
   * Known-broken, stated as the behaviour we want rather than the behaviour we
   * have: when the fix lands this starts passing, vitest reports the unexpected
   * pass, and the `.fails` comes off. Written the other way round — asserting
   * today's output — a correct fix would look like a test failure.
   *
   * Three defects, one cause: the body is dropped but the response record keeps
   * claiming it is there.
   *   1. the archived HTTP message advertises the original content-length (and
   *      content-encoding) over an empty body
   *   2. no WARC-Truncated field marks the record as cut short
   *   3. the CDXJ line loses `digest`, which CDXJ 0.1.0 requires
   */
  it.fails("keeps its headers honest and flags the truncation", async ({ annotate }) => {
    const { warc, cdxj } = await oversizedCapture(annotate);

    expect(warc).toContain("WARC-Truncated: length");
    expect(warc).not.toMatch(new RegExp(`content-length: ${String(OVERSIZED_BYTES)}`, "i"));
    expect(cdxj.every((line) => "digest" in line)).toBe(true);
  });

  /**
   * A fourth defect, with a different cause from the three above — hence its own
   * block, so fixing one group does not mask the other.
   *
   * The size check reads `encodedDataLength` off `Network.loadingFinished`, which
   * is the whole transfer; the metadata record reads it off the earlier
   * `Network.responseReceived`, which is only what had arrived by then — the
   * headers. So a 21 MiB body that was dropped is filed as ~156 bytes, and the
   * one record that exists to explain what went missing understates it by five
   * orders of magnitude.
   */
  it.fails("reports the size of what was actually dropped", async ({ annotate }) => {
    const { warc } = await oversizedCapture(annotate);

    const reported = Number(metadataField(warc, "encodedDataLength"));
    expect(reported).toBeGreaterThan(CAP_BYTES);
  });
});
