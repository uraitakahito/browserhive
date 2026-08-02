/**
 * How much of the page a capture actually reached.
 *
 * `completeness` and `coverage` answer different questions and the difference
 * is the reason this file exists. `completeness` asks whether the responses
 * that were recorded kept their bodies — it is decided by the WARC alone.
 * `coverage` asks whether the capture ever got far enough down the page to
 * request them in the first place, which the WARC cannot say: a resource never
 * scrolled into view leaves no trace at all.
 *
 * Measured against www.yahoo.co.jp: five captures, `autoscroll` stopped at the
 * 40-step cap every time, and every archive reported `complete: true`. Both
 * statements were correct. Neither said the page had been cut at 32,000px.
 */
import { describe, it, expect } from "vitest";

import { analyzeCoverage } from "../../../src/storage/wacz/coverage.js";
import type { BehaviorRunReport } from "../../../src/behaviors/types.js";

const VIEWPORT = 800;

const reportWith = (decisions?: Record<string, string | number | boolean>): BehaviorRunReport => ({
  ran: [{ id: "autoscroll", steps: 41, ms: 11_160, ...(decisions && { decisions }) }],
  timedOut: false,
});

describe("analyzeCoverage", () => {
  it("reports the page as covered when the behavior ran out of page", () => {
    const coverage = analyzeCoverage(
      reportWith({ stopped: "bottom reached after 7 steps", reachedBottom: true, scrollSteps: 7 }),
      VIEWPORT,
    );

    expect(coverage).toEqual({ scrollExhausted: false, scrollSteps: 7, scrolledPx: 5_600 });
  });

  it("reports it as cut short when the step cap is what stopped it", () => {
    // The yahoo.co.jp case, with its measured numbers.
    const coverage = analyzeCoverage(
      reportWith({
        stopped: "maxSteps 40 reached — bottom NOT reached",
        reachedBottom: false,
        scrollSteps: 40,
      }),
      VIEWPORT,
    );

    expect(coverage).toEqual({ scrollExhausted: true, scrollSteps: 40, scrolledPx: 32_000 });
  });

  it("reads the boolean, not the sentence", () => {
    // `stopped` is written for a person and will be reworded eventually. A
    // coverage report that parsed it would keep passing while silently
    // reporting the opposite of what happened, so the two are kept apart:
    // the sentence is for logs, `reachedBottom` is for this function.
    const coverage = analyzeCoverage(
      reportWith({ stopped: "bottom reached after 40 steps", reachedBottom: false, scrollSteps: 40 }),
      VIEWPORT,
    );

    expect(coverage?.scrollExhausted).toBe(true);
  });

  it("says nothing when autoscroll did not run", () => {
    // Behaviors can be turned off entirely. Absent is not the same as
    // `scrollExhausted: false`, which would claim the page was covered.
    expect(analyzeCoverage({ ran: [{ id: "autofetch", steps: 3, ms: 12 }], timedOut: false }, VIEWPORT))
      .toBeUndefined();
    expect(analyzeCoverage(undefined, VIEWPORT)).toBeUndefined();
  });

  it("says nothing when autoscroll ran but decided nothing", () => {
    // A behavior that errored mid-run reports no decisions. Guessing from
    // `steps` here is exactly the mistake this whole change exists to fix.
    expect(analyzeCoverage(reportWith(), VIEWPORT)).toBeUndefined();
  });
});
