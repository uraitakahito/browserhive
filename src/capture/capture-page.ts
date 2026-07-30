/**
 * The slice of `Page` the capture path uses, plus the adapter that paces it.
 *
 * Asking for `CapturePage` instead of the full `Page` is what lets a delay be
 * slipped in front of every browser operation in a type-safe way: `Pick` means
 * only methods that really exist can be listed, and their signatures follow
 * puppeteer automatically.
 *
 * Start using another `Page` method in the capture path and TypeScript will
 * point here — add it to the list (and to `withOperationDelay`).
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { Page } from "puppeteer";

/**
 * Everything `page-capturer`, `banner-dismisser` and `behaviors/inject` call on
 * a page. `url` is the only synchronous member; the rest return promises.
 */
export type CapturePage = Pick<
  Page,
  | "goto"
  | "evaluate"
  | "createCDPSession"
  | "waitForNetworkIdle"
  | "waitForNavigation"
  | "screenshot"
  | "content"
  | "title"
  | "addStyleTag"
  | "setViewport"
  | "setUserAgent"
  | "setExtraHTTPHeaders"
  | "setCacheEnabled"
  | "url"
>;

/**
 * A running total of the pauses this capture injected in order to be watched.
 *
 * `operationDelayMs` sleeps before each browser call, and those sleeps happen
 * inside whatever per-operation budget is in force. A budget is there to catch
 * a stuck page, so it should not be spent on a pause we chose to insert — but
 * the budget has no way to tell the two apart on its own. The ledger is how it
 * finds out: `withOperationTimeout` reads it before and after, and treats the
 * difference as time that did not count.
 *
 * Cumulative and monotonic on purpose. Any interval's share is just
 * (value at the end − value at the start), so no per-interval bookkeeping is
 * needed and nothing has to be reset.
 *
 * The value only ever counts time that has ALREADY passed — including the
 * elapsed part of a pause still in progress. Both halves of that matter:
 *
 *   - Crediting a pause up front would let a budget discount time that has not
 *     passed yet, making the timeout quietly more lenient than its number says.
 *   - Crediting it only once finished breaks whenever a pause outlasts the
 *     budget it sits inside. The deadline fires mid-pause, sees nothing
 *     injected, and reports a timeout for time we spent sleeping. A 5s budget
 *     with an 8s pause in front of it could never have succeeded.
 */
export interface PacingLedger {
  readonly injectedMs: number;
}

/** A page to drive, paired with the ledger of pauses taken while driving it. */
export interface PacedPage {
  page: CapturePage;
  pacing: PacingLedger;
}

/**
 * Delay every browser operation this capture performs, so a headless run can be
 * followed live over the DevTools screencast. The connection is untouched, so
 * this affects one capture only; `delayMs <= 0` returns the raw Page, keeping
 * the wrapper off the normal path entirely.
 *
 * NOT puppeteer's `slowMo`, and deliberately not named after it. `slowMo` is a
 * connect-time option that puppeteer applies to every CDP command it issues,
 * including its own internal ones; this adapter only paces the calls WE make,
 * and does so per request. Borrowing the name would promise behaviour we do not
 * deliver. `operationDelayMs` says what actually happens — a delay before each
 * operation — and carries its unit, matching `pageLoadMs` / `taskTotalMs`.
 *
 * (A connect-time `slowMo` did exist, as `--slow-mo`; it was removed in favour
 * of this so there is exactly one delay knob. See `browser.ts` for why it is
 * not coming back, and `CaptureConfig.operationDelayMs` for the server default.)
 */
export const createPacedPage = (page: Page, delayMs: number): PacedPage => {
  if (delayMs <= 0) return { page, pacing: { injectedMs: 0 } };

  let completedMs = 0;
  let inFlight = 0;
  let sleepingSince = 0;

  const ledger: PacingLedger = {
    get injectedMs(): number {
      if (inFlight === 0) return completedMs;
      // Credit the part of the current pause that has actually passed, capped
      // at its nominal length so a slow event loop cannot over-credit.
      const elapsed = Math.min(Date.now() - sleepingSince, delayMs);
      return completedMs + elapsed;
    },
  };

  // Wait BEFORE issuing the operation, matching how puppeteer's slowMo orders
  // things: the gap belongs in front of the call, not around its result.
  const pace = async <T>(op: () => Promise<T>): Promise<T> => {
    // The capture path issues these one at a time; the counter is there so an
    // overlapping pair would still be measured from the earliest start rather
    // than double-counted.
    if (inFlight === 0) sleepingSince = Date.now();
    inFlight += 1;
    try {
      await sleep(delayMs);
    } finally {
      inFlight -= 1;
      if (inFlight === 0) completedMs += delayMs;
    }
    return op();
  };

  const paced: CapturePage = {
    goto: (...args) => pace(() => page.goto(...args)),
    evaluate: ((...args: Parameters<Page["evaluate"]>) =>
      pace(() => page.evaluate(...args))) as Page["evaluate"],
    createCDPSession: () => pace(() => page.createCDPSession()),
    waitForNetworkIdle: (...args) => pace(() => page.waitForNetworkIdle(...args)),
    waitForNavigation: (...args) => pace(() => page.waitForNavigation(...args)),
    screenshot: ((...args: Parameters<Page["screenshot"]>) =>
      pace(() => page.screenshot(...args))) as Page["screenshot"],
    content: () => pace(() => page.content()),
    title: () => pace(() => page.title()),
    addStyleTag: ((...args: Parameters<Page["addStyleTag"]>) =>
      pace(() => page.addStyleTag(...args))) as Page["addStyleTag"],
    setViewport: (...args) => pace(() => page.setViewport(...args)),
    setUserAgent: ((...args: Parameters<Page["setUserAgent"]>) =>
      pace(() => page.setUserAgent(...args))) as Page["setUserAgent"],
    setExtraHTTPHeaders: (...args) =>
      pace(() => page.setExtraHTTPHeaders(...args)),
    setCacheEnabled: (...args) => pace(() => page.setCacheEnabled(...args)),
    // Synchronous: there is nothing to wait for, and delaying it would mean
    // handing back a promise the callers do not expect.
    url: () => page.url(),
  };
  return { page: paced, pacing: ledger };
};
