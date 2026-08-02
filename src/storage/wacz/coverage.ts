/**
 * How much of the page a capture reached.
 *
 * The sibling of `completeness.ts`, answering the question that one cannot.
 * `completeness` is decided by the WARC: of the responses recorded, did any
 * lose their body? `coverage` is decided by what the browser was made to do:
 * did the capture ever get far enough down the page for those responses to be
 * requested at all? A resource below the point where scrolling stopped leaves
 * no record of any kind, so no amount of reading the archive can find it.
 *
 * Measured against www.yahoo.co.jp on 2026-08-02: five captures in a row,
 * `autoscroll` stopped at its 40-step cap every time — 32,000px at the 800px
 * viewport, on a feed with no bottom — and every archive reported
 * `complete: true`. Both statements were true. Neither was the one a reader
 * needed.
 *
 * Kept out of `CompletenessReport` on purpose. That report is a pure function
 * over recorded responses, which is what lets the same invariant run in unit
 * tests, in e2e against a real archive, and in production. Coverage comes from
 * a behavior's own account of itself, so folding it in would cost that
 * property for every caller, including the ones that never asked about
 * scrolling.
 */
import type { BehaviorRunReport } from "../../behaviors/types.js";

export interface CoverageReport {
  /**
   * True when scrolling stopped because it hit its step cap rather than the
   * end of the page — so whatever lies below was never requested.
   */
  scrollExhausted: boolean;
  /** Steps actually taken. */
  scrollSteps: number;
  /** Roughly how far down the page the capture got: steps × viewport height. */
  scrolledPx: number;
}

/**
 * Build the coverage report from what `autoscroll` said about itself.
 *
 * Returns undefined rather than a default when there is nothing to report —
 * behaviors can be switched off, and one that errored mid-run reports no
 * decisions at all. `scrollExhausted: false` would be a claim that the page
 * was covered, which is precisely the claim that was being made wrongly
 * before this existed.
 */
export const analyzeCoverage = (
  report: BehaviorRunReport | undefined,
  viewportHeight: number,
): CoverageReport | undefined => {
  const autoscroll = report?.ran.find((r) => r.id === "autoscroll");
  const decisions = autoscroll?.decisions;
  if (decisions === undefined) return undefined;

  // `reachedBottom` and `scrollSteps` rather than parsing `stopped`. That
  // string is written for a person reading a log and will be reworded; a
  // regular expression over it would keep passing while reporting the
  // opposite of what happened.
  const reachedBottom = decisions["reachedBottom"];
  const scrollSteps = decisions["scrollSteps"];
  if (typeof reachedBottom !== "boolean" || typeof scrollSteps !== "number") return undefined;

  return {
    scrollExhausted: !reachedBottom,
    scrollSteps,
    scrolledPx: scrollSteps * viewportHeight,
  };
};
