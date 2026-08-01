import { describe, it, expect } from "vitest";
import { analyzeCompleteness } from "../../../src/storage/wacz/completeness.js";
import type { RecordedResponse } from "../../../src/capture/network-recorder-types.js";

/** Minimal recorded response; only `url` and `status` drive the invariant. */
const rec = (
  url: string,
  status: number,
  overrides: Partial<RecordedResponse> = {},
): RecordedResponse => ({
  url,
  status,
  date: "2026-07-26T00:00:00.000Z",
  mime: "application/javascript",
  offset: 0,
  length: 1,
  ...overrides,
});

describe("analyzeCompleteness", () => {
  it("flags a URL seen only as 304 (body never crossed the wire)", () => {
    const report = analyzeCompleteness([rec("https://x.test/app.js", 304)]);

    expect(report.bodylessUrls).toEqual(["https://x.test/app.js"]);
    expect(report.complete).toBe(false);
  });

  it("accepts a URL that also has a 200 (revalidated, but the body is archived)", () => {
    const report = analyzeCompleteness([
      rec("https://x.test/app.js", 200),
      rec("https://x.test/app.js", 304),
    ]);

    expect(report.bodylessUrls).toEqual([]);
    expect(report.complete).toBe(true);
  });

  it("does not flag legitimately bodyless responses (redirects, 204)", () => {
    const report = analyzeCompleteness([
      rec("https://x.test/redirect", 302),
      rec("https://x.test/beacon", 204),
      rec("https://x.test/page", 200, { mime: "text/html" }),
    ]);

    expect(report.complete).toBe(true);
  });

  it("reports every offending URL, sorted and de-duplicated", () => {
    const report = analyzeCompleteness([
      rec("https://x.test/b.css", 304),
      rec("https://x.test/a.js", 304),
      rec("https://x.test/a.js", 304),
      rec("https://x.test/ok.js", 200),
    ]);

    expect(report.bodylessUrls).toEqual([
      "https://x.test/a.js",
      "https://x.test/b.css",
    ]);
  });

  it("treats an empty capture as complete", () => {
    expect(analyzeCompleteness([])).toEqual({
      bodylessUrls: [],
      truncatedUrls: [],
      complete: true,
    });
  });

  it("flags a body dropped for exceeding the per-response cap", () => {
    const report = analyzeCompleteness([
      rec("https://x.test/big.mp4", 200, { bodySkipReason: "too-large" }),
    ]);

    expect(report.truncatedUrls).toEqual(["https://x.test/big.mp4"]);
    expect(report.complete).toBe(false);
  });

  it("flags a body dropped for exceeding the cumulative cap", () => {
    const report = analyzeCompleteness([
      rec("https://x.test/late.png", 200, { bodySkipReason: "task-cap" }),
    ]);

    expect(report.truncatedUrls).toEqual(["https://x.test/late.png"]);
    expect(report.complete).toBe(false);
  });

  it("does NOT flag a body omitted by the content-type filter", () => {
    // `skipContentTypes` is something the caller configured; answering "your
    // archive is incomplete because you asked for less" tells them nothing they
    // did not already know. The caps are different — they fire on defaults, and
    // the caller never asked to lose that body.
    const report = analyzeCompleteness([
      rec("https://x.test/movie.mp4", 200, { bodySkipReason: "content-type" }),
    ]);

    expect(report.truncatedUrls).toEqual([]);
    expect(report.complete).toBe(true);
  });

  it("keeps the two kinds of loss apart, and de-duplicates each", () => {
    // Both lists populated at once: a reader has to be able to tell "the origin
    // said 304" from "we dropped it ourselves", because only the second is
    // something this side can fix.
    const report = analyzeCompleteness([
      rec("https://x.test/app.js", 304),
      rec("https://x.test/big.mp4", 200, { bodySkipReason: "too-large" }),
      rec("https://x.test/big.mp4", 200, { bodySkipReason: "too-large" }),
    ]);

    expect(report.bodylessUrls).toEqual(["https://x.test/app.js"]);
    expect(report.truncatedUrls).toEqual(["https://x.test/big.mp4"]);
    expect(report.complete).toBe(false);
  });
});
