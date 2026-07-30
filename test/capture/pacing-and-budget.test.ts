/**
 * Regression tests for the seam between pacing and the operation budget.
 *
 * Both halves were already well covered — `capture-page.test.ts` exercises the
 * pacer, `page-capturer-timeout.test.ts` exercises the Layer A budgets — and
 * neither ever called the other. The bug lived exactly there: `operationDelayMs`
 * was spent inside the budget, so any delay of ~2s or more made the 3s
 * dynamic-content wait exceed its 5s budget and fail every single time.
 *
 * The invariant these tests pin down fits in one line:
 *
 *   An operation budget bounds the time spent ON THE OPERATION. It does not
 *   count the pauses we inject ourselves in order to watch it.
 *
 * And the mirror image, which matters just as much:
 *
 *   The wall clock DOES count those pauses. A capture slowed down on purpose
 *   is still a slow capture, and the task budget exists to stop those.
 *
 * ## Why real timers here
 *
 * The durations are milliseconds and the clock is real. Fake timers do not
 * drive `node:timers/promises` — which is what the pacer sleeps on — reliably
 * once a paced sleep is being raced rather than awaited directly, and the
 * property under test is about ratios, not absolute durations. Scaled down
 * like this the whole file runs in well under a second.
 */
import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import { createPacedPage } from "../../src/capture/capture-page.js";
import {
  withOperationTimeout,
  withWallClockTimeout,
} from "../../src/capture/timeouts.js";

/** A page whose `evaluate` occupies `evaluateMs` of its own before resolving. */
const buildPage = (evaluateMs: number): Page =>
  ({
    evaluate: vi.fn(
      () => new Promise((resolve) => setTimeout(resolve, evaluateMs)),
    ),
    url: vi.fn().mockReturnValue("https://example.com/"),
  }) as unknown as Page;

/** A page whose `evaluate` never resolves — a wedged execution context. */
const hangingPage = (): Page =>
  ({
    evaluate: vi.fn(() => new Promise(() => undefined)),
  }) as unknown as Page;

describe("operation budget vs injected pacing", () => {
  it("does not spend the operation budget on the pacing", async () => {
    // The shape of the incident, scaled down: a 30ms operation against a 50ms
    // budget, with a 40ms pause in front of it. Counting the pause puts the
    // total at 70ms and the operation fails; not counting it leaves headroom.
    const { page, pacing } = createPacedPage(buildPage(30), 40);

    await expect(
      withOperationTimeout(
        page.evaluate(() => undefined),
        50,
        "dynamic content wait",
        pacing,
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps holding the budget open across several pauses", async () => {
    // One budget can cover several paced calls — runBehaviors makes three.
    // Adding a fixed multiple of the delay would have to know that number;
    // reading the ledger does not.
    const { page, pacing } = createPacedPage(buildPage(0), 30);

    const work = (async () => {
      await page.evaluate(() => undefined);
      await page.evaluate(() => undefined);
      await page.evaluate(() => undefined);
    })();

    // Three 30ms pauses around work that takes essentially none. Wall time is
    // ~90ms; the operation's own share is ~0, so a 50ms budget is ample once
    // the pauses stop being charged to it.
    await expect(
      withOperationTimeout(work, 50, "behaviors", pacing),
    ).resolves.toBeUndefined();
    expect(pacing.injectedMs).toBe(90);
  });

  it("still times out when the operation itself overruns", async () => {
    // The guard against "fixing" this by making the budget unbounded. 200ms of
    // real work exceeds a 50ms budget no matter how much pacing is subtracted.
    const { page, pacing } = createPacedPage(buildPage(200), 10);

    await expect(
      withOperationTimeout(
        page.evaluate(() => undefined),
        50,
        "dynamic content wait",
        pacing,
      ),
    ).rejects.toThrow(/dynamic content wait/);
  });

  it("still times out when the operation never settles at all", async () => {
    // Pacing must not rescue a wedged page. Once the last paced call has been
    // issued the ledger stops growing, so the deadline stops moving with it.
    const { page, pacing } = createPacedPage(hangingPage(), 20);

    await expect(
      withOperationTimeout(
        page.evaluate(() => undefined),
        50,
        "dynamic content wait",
        pacing,
      ),
    ).rejects.toThrow(/dynamic content wait/);
  });

  it("counts the pacing against the wall clock", async () => {
    // The mirror invariant. Layer B asks "has this task taken too long?", and
    // a pause we inserted is time the task really took. Subtracting it here
    // would let operationDelayMs keep a task alive indefinitely.
    const { page } = createPacedPage(buildPage(10), 200);

    await expect(
      withWallClockTimeout(
        page.evaluate(() => undefined),
        50,
        "task processing",
      ),
    ).rejects.toThrow(/task processing/);
  });
});

describe("PacingLedger", () => {
  it("never credits a pause beyond the time that has actually passed", async () => {
    // Crediting up front would let a budget subtract time that has not passed
    // yet, making the timeout quietly more lenient than its number claims.
    const { page, pacing } = createPacedPage(buildPage(0), 50);

    const pending = page.evaluate(() => undefined);
    expect(pacing.injectedMs).toBeLessThan(50);

    await pending;
    expect(pacing.injectedMs).toBe(50);
  });

  it("credits a pause that is still running, so a long one is not lost", async () => {
    // Waiting for the pause to finish before crediting it breaks whenever the
    // pause outlasts the budget around it: the deadline fires mid-pause, sees
    // nothing, and calls it a timeout. This is what made an 8s delay fail
    // against a 5s budget.
    const { page, pacing } = createPacedPage(buildPage(0), 200);

    const pending = page.evaluate(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(pacing.injectedMs).toBeGreaterThan(50);
    expect(pacing.injectedMs).toBeLessThanOrEqual(200);

    await pending;
  });

  it("accumulates across operations", async () => {
    const { page, pacing } = createPacedPage(buildPage(0), 20);

    await page.evaluate(() => undefined);
    await page.evaluate(() => undefined);

    expect(pacing.injectedMs).toBe(40);
  });

  it("stays at zero when pacing is off, so the raw page keeps its identity", () => {
    const raw = buildPage(0);
    const { page, pacing } = createPacedPage(raw, 0);

    // No wrapper on the normal path — the same object comes back.
    expect(page).toBe(raw);
    expect(pacing.injectedMs).toBe(0);
  });
});
