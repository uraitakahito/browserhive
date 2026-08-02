/**
 * Built-in behavior: autoscroll (BROWSER side).
 *
 * Ported from the former native `page-capturer.ts:autoScroll`. Scrolls the
 * full document height so scroll-triggered lazy loaders (`loading="lazy"`,
 * IntersectionObserver, `data-src`) fire and their resources are recorded,
 * then returns to the top for the screenshot. A `yield` after each step lets
 * the runner enforce its wall-clock deadline (no infinite-scroll hang).
 */
import type { BehaviorCtx, BehaviorDecisions } from "../types";

export class AutoScrollBehavior {
  static id = "autoscroll";
  static isMatch(): boolean {
    return true;
  }

  async *run(
    ctx: BehaviorCtx,
  ): AsyncGenerator<{ msg: string; counter?: string }, BehaviorDecisions> {
    const maxSteps = Number(ctx.opts.maxSteps ?? 40);
    const stepDelayMs = Number(ctx.opts.stepDelayMs ?? 250);
    const settleMs = Number(ctx.opts.idleTimeMs ?? 1000);

    let last = -1;
    let steps = 0;
    // Distinguishing these two is the whole point of reporting a decision:
    // "ran out of steps" means the page below the cut-off was never scrolled
    // into view, so its lazy resources are missing from the archive.
    let reachedBottom = false;
    while (steps++ < maxSteps) {
      window.scrollBy(0, window.innerHeight);
      await ctx.Lib.sleep(stepDelayMs);
      yield ctx.getState("scrolled", "steps");
      if (window.scrollY === last) {
        reachedBottom = true;
        break;
      }
      last = window.scrollY;
    }
    window.scrollTo(0, 0); // back to the top for the screenshot
    await ctx.Lib.sleep(settleMs); // brief settle for freshly-triggered loads
    yield ctx.getState("settled");

    // Two values for two readers. `stopped` is a sentence someone reads in a
    // log and will get reworded; `reachedBottom` and `scrollSteps` are what
    // `analyzeCoverage` reads, so rewording the sentence cannot silently
    // invert the archive's own account of itself.
    //
    // `steps` ends one past the count taken, because the guard increments
    // before the body runs — the reported figure is the real one.
    return {
      stopped: reachedBottom
        ? `bottom reached after ${String(steps)} steps`
        : `maxSteps ${String(maxSteps)} reached — bottom NOT reached`,
      reachedBottom,
      scrollSteps: reachedBottom ? steps : maxSteps,
    };
  }
}
