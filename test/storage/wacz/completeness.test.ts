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
    expect(analyzeCompleteness([])).toEqual({ bodylessUrls: [], complete: true });
  });
});
