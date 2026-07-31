/**
 * E2E for the seam between injected pacing and the per-operation budgets.
 *
 * `operationDelayMs` sleeps before each browser call. Those sleeps used to be
 * spent INSIDE the Layer A budgets, so the 3s dynamic-content wait blew its 5s
 * budget for any delay past ~2s — and the API accepted delays up to 5s. Every
 * one of those captures was accepted with a 202 and then failed three times
 * over.
 *
 * The unit suite (`test/capture/pacing-and-budget.test.ts`) pins the arithmetic
 * against a mock page. What it cannot show is that the same holds when a real
 * Chrome is on the other end, which is the only place the bug ever surfaced.
 */
import { describe, it, expect, inject } from "vitest";
import { scenarios } from "meadow";

import { submitAndWait, captureRequest } from "./helpers/capture.js";

const api = inject("api");
const meadow = inject("meadow");

describe("pacing does not consume the operation budgets", () => {
  it("operationDelayMs=2000 still succeeds", async ({ annotate }) => {
    // The regression itself. `/plain-html` settles instantly, so the only thing
    // can push the dynamic-content wait over its 5s budget is the pause we
    // inserted ourselves — which is exactly what must not happen.
    //
    // Before the fix this failed with:
    //   Timeout: Dynamic content wait for http://…/plain-html (5000ms)
    const report = await submitAndWait(
      api,
      captureRequest(meadow + scenarios.plainHtml, { operationDelayMs: 2000 }),
      annotate,
    );

    expect(report.status).toBe("success");
    // Not rescued by a retry that happened to get luckier.
    expect(report.retryCount).toBe(0);
  });
});

/**
 * The other half of the invariant: budgets must still expire.
 *
 * `withOperationTimeout` deliberately pushes its own deadline out as pacing is
 * injected, which is a loop that hands back time it has already granted. That
 * it terminates is argued from the ledger being bounded — worth confirming
 * against a real browser rather than a mock that resolves in 200ms.
 *
 * `/block-main-thread` is the only fixture that can force it. A slow response
 * delays the navigation; only a held main thread stops an injected
 * `page.evaluate` from running at all.
 *
 * The dynamic-content wait sleeps 3s in the page against a 5s budget, so a hold
 * longer than 2s is enough to overrun it.
 */
describe("operation budgets still expire against a real browser", () => {
  it("a hold inside the budget still succeeds", async ({ annotate }) => {
    // 3000 (the in-page sleep) + at most 500 waiting to enter + at most 500 of
    // timer lateness = 4000, comfortably under the 5000 budget. A 1000ms hold
    // would land exactly on it.
    const report = await submitAndWait(
      api,
      captureRequest(meadow + scenarios.blockMainThread(500, 10_000)),
      annotate,
    );

    expect(report.status).toBe("success");
  });

  it("a hold past the budget fails, pacing or not", async ({ annotate }) => {
    // 6000 of held thread against a 5000 budget: the evaluate cannot even
    // start in time. This is the assertion that the fix did not quietly make
    // the budgets unbounded.
    const report = await submitAndWait(
      api,
      captureRequest(meadow + scenarios.blockMainThread(6000, 20_000)),
      annotate,
    );

    expect(report.status).not.toBe("success");
    expect(report.errorDetails?.message).toMatch(/Dynamic content wait/);
  });

  it("adding pacing does not rescue an overrun", async ({ annotate }) => {
    // The ledger credits pauses WE injected. Time the page spent on itself is
    // not ours to discount, so this must fail exactly like the run above.
    const report = await submitAndWait(
      api,
      captureRequest(meadow + scenarios.blockMainThread(6000, 20_000), {
        operationDelayMs: 2000,
      }),
      annotate,
    );

    expect(report.status).not.toBe("success");
    expect(report.errorDetails?.message).toMatch(/Dynamic content wait/);
  });

  it("the worker is not left wedged by a held page", async ({ annotate }) => {
    // The runs above end with a capture failed and the tab still holding its
    // thread. `resetPageState` navigates to about:blank, which is browser-side
    // work and should not care — but "should not" is the reason this test is
    // here rather than a comment.
    const report = await submitAndWait(api, captureRequest(meadow + scenarios.plainHtml), annotate);

    expect(report.status).toBe("success");
    expect(report.retryCount).toBe(0);
  });
});
