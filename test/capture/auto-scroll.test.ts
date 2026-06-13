/**
 * `autoScroll` unit tests.
 *
 * The scroll loop runs in-browser via `page.evaluate(fn, arg)`. We mock the
 * page so `evaluate` executes that callback in Node against a fake `window`
 * (scrollBy / scrollTo / scrollY / innerHeight), which lets us assert the
 * loop's real behaviour: scroll to the bottom, return to the top, bounded by
 * `maxSteps`, then wait for network idle.
 */
import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import { autoScroll } from "../../src/capture/page-capturer.js";

const OPTS = { stepDelayMs: 0, maxSteps: 100, idleTimeMs: 0, idleTimeoutMs: 50 };

/** Fake page whose `evaluate` runs the in-browser fn against a fake window. */
const makeFakePage = (geo: { innerHeight: number; scrollHeight: number }) => {
  let scrollY = 0;
  let maxScrollY = 0;
  const cap = Math.max(0, geo.scrollHeight - geo.innerHeight);
  const win = {
    innerHeight: geo.innerHeight,
    get scrollY() {
      return scrollY;
    },
    scrollBy: (_x: number, y: number): void => {
      scrollY = Math.min(scrollY + y, cap);
      if (scrollY > maxScrollY) maxScrollY = scrollY;
    },
    scrollTo: (_x: number, y: number): void => {
      scrollY = y;
    },
  };
  const waitForNetworkIdle = vi.fn(() => Promise.resolve());
  const page = {
    waitForNetworkIdle,
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown): Promise<unknown> => {
      const prev = (globalThis as Record<string, unknown>)["window"];
      (globalThis as Record<string, unknown>)["window"] = win;
      try {
        return await fn(arg);
      } finally {
        (globalThis as Record<string, unknown>)["window"] = prev;
      }
    },
  };
  return {
    page,
    waitForNetworkIdle,
    get maxScrollY() {
      return maxScrollY;
    },
    get finalScrollY() {
      return scrollY;
    },
  };
};

describe("autoScroll", () => {
  it("scrolls to the bottom, returns to the top, and waits for network idle", async () => {
    const fake = makeFakePage({ innerHeight: 800, scrollHeight: 3200 });
    await autoScroll(fake.page as unknown as Page, OPTS);
    expect(fake.maxScrollY).toBeGreaterThanOrEqual(3200 - 800); // reached the bottom
    expect(fake.finalScrollY).toBe(0); // returned to the top (for the screenshot)
    expect(fake.waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("stops after maxSteps on an infinitely-growing page", async () => {
    let scrollY = 0;
    let calls = 0;
    const win = {
      innerHeight: 800,
      get scrollY() {
        return scrollY;
      },
      scrollBy: (_x: number, y: number): void => {
        scrollY += y; // never plateaus → only maxSteps can stop the loop
        calls++;
      },
      scrollTo: (_x: number, y: number): void => {
        scrollY = y;
      },
    };
    const page = {
      waitForNetworkIdle: vi.fn(() => Promise.resolve()),
      evaluate: async (fn: (arg: unknown) => unknown, arg: unknown): Promise<unknown> => {
        const prev = (globalThis as Record<string, unknown>)["window"];
        (globalThis as Record<string, unknown>)["window"] = win;
        try {
          return await fn(arg);
        } finally {
          (globalThis as Record<string, unknown>)["window"] = prev;
        }
      },
    };
    await autoScroll(page as unknown as Page, { ...OPTS, maxSteps: 5 });
    expect(calls).toBe(5); // exactly maxSteps scrollBy calls
    expect(scrollY).toBe(0); // scrollTo(0, 0) at the end
  });
});
