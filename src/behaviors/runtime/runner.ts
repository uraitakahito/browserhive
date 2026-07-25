/**
 * Behavior runner (BROWSER side). Exposed to the page as `self.__bh_behaviors`.
 *
 * Runs the enabled behaviors as cooperative async generators: each `yield`
 * is a checkpoint where the shared wall-clock deadline is checked, so a
 * runaway behavior (infinite scroll) is stopped without hanging the capture.
 * `run()` returns a serializable report to Node — no exposeFunction needed.
 */
import type {
  BehaviorClass,
  BehaviorCtx,
  BehaviorRunReport,
  RunOpts,
} from "./types";
import { Lib } from "./lib";

class BehaviorRunner {
  private readonly registry: BehaviorClass[] = [];

  register(behavior: BehaviorClass): void {
    this.registry.push(behavior);
  }

  private safeIsMatch(behavior: BehaviorClass): boolean {
    try {
      return behavior.isMatch();
    } catch {
      return false;
    }
  }

  async run(opts: RunOpts): Promise<BehaviorRunReport> {
    const report: BehaviorRunReport = { ran: [], timedOut: false };

    // Resolve in the caller's requested order, honouring isMatch().
    const active: BehaviorClass[] = [];
    for (const id of opts.enabled) {
      const behavior = this.registry.find((b) => b.id === id);
      if (behavior && this.safeIsMatch(behavior)) active.push(behavior);
    }

    const deadline = Date.now() + opts.timeoutMs;

    for (const Behavior of active) {
      const start = Date.now();
      let steps = 0;
      let error: string | undefined;
      const ctx: BehaviorCtx = {
        Lib,
        opts: opts.options[Behavior.id] ?? {},
        getState: (msg, counter) => ({ msg, counter }),
      };
      try {
        for await (const _state of new Behavior().run(ctx)) {
          steps++;
          if (Date.now() > deadline) {
            report.timedOut = true;
            break;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      report.ran.push({
        id: Behavior.id,
        steps,
        ms: Date.now() - start,
        ...(error ? { error } : {}),
      });
      if (report.timedOut) break;
    }

    return report;
  }
}

export const runner = new BehaviorRunner();
