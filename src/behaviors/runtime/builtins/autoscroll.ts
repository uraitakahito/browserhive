/**
 * Built-in behavior: autoscroll (BROWSER side).
 *
 * Ported from the former native `page-capturer.ts:autoScroll`. Scrolls the
 * full document height so scroll-triggered lazy loaders (`loading="lazy"`,
 * IntersectionObserver, `data-src`) fire and their resources are recorded,
 * then returns to the top for the screenshot. A `yield` after each step lets
 * the runner enforce its wall-clock deadline (no infinite-scroll hang).
 */
import type { BehaviorCtx } from "../types";

export class AutoScrollBehavior {
  static id = "autoscroll";
  static isMatch(): boolean {
    return true;
  }

  async *run(ctx: BehaviorCtx): AsyncGenerator<{ msg: string; counter?: string }> {
    const maxSteps = Number(ctx.opts.maxSteps ?? 40);
    const stepDelayMs = Number(ctx.opts.stepDelayMs ?? 250);
    const settleMs = Number(ctx.opts.idleTimeMs ?? 1000);

    let last = -1;
    let steps = 0;
    while (steps++ < maxSteps) {
      window.scrollBy(0, window.innerHeight);
      await ctx.Lib.sleep(stepDelayMs);
      yield ctx.getState("scrolled", "steps");
      if (window.scrollY === last) break; // reached the bottom
      last = window.scrollY;
    }
    window.scrollTo(0, 0); // back to the top for the screenshot
    await ctx.Lib.sleep(settleMs); // brief settle for freshly-triggered loads
    yield ctx.getState("settled");
  }
}
