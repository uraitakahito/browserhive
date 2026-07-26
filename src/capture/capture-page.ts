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
export const withOperationDelay = (
  page: Page,
  delayMs: number,
): CapturePage => {
  if (delayMs <= 0) return page;

  // Wait BEFORE issuing the operation, matching how puppeteer's slowMo orders
  // things: the gap belongs in front of the call, not around its result.
  const pace = async <T>(op: () => Promise<T>): Promise<T> => {
    await sleep(delayMs);
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
  return paced;
};
