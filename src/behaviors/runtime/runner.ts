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
  BehaviorDecisions,
  BehaviorRunReport,
  RunOpts,
} from "./types";
import { Lib } from "./lib";

/**
 * Same prefix the Node side uses, duplicated rather than imported: this file is
 * bundled into the page by esbuild and must not pull in Node-side modules.
 */
const TRACE_PREFIX = "[bh]";

export class BehaviorRunner {
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
    //
    // Site behaviors are not opted into by id — they are always considered and
    // isMatch() (a host check) decides. They go last so the built-ins have
    // already primed the page: a site behavior typically acts on what
    // autoscroll / autofetch surfaced.
    const siteIds =
      opts.siteBehaviors === false
        ? []
        : this.registry.filter((b) => b.siteSpecific === true).map((b) => b.id);

    const active: BehaviorClass[] = [];
    for (const id of [...opts.enabled, ...siteIds]) {
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
      // Driven by hand rather than with `for await` because the interesting
      // part is the generator's RETURN value — what the behavior decided —
      // and `for await` discards it.
      //
      // The cost of doing that is having to close the generator ourselves on
      // the timeout path: `for await` calls `.return()` when it breaks, which
      // is what runs a behavior's `finally`. Skipping it would leave the
      // behavior suspended mid-run forever.
      let decisions: BehaviorDecisions | undefined;
      const iterator = new Behavior().run(ctx);
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done === true) {
            decisions = next.value ?? undefined;
            break;
          }
          steps++;
          if (Date.now() > deadline) {
            report.timedOut = true;
            await iterator.return(undefined);
            break;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      // Why the behavior did what it did. Not the same as progress: `steps`
      // says how far it got, this says what it concluded — and only one of
      // those tells you whether the page was actually covered.
      //
      // The trace prints inside the captured page, so it is for someone
      // watching a capture happen. The copy on the report below is the one
      // that leaves the browser.
      if (opts.trace === true && decisions !== undefined) {
        console.group(`${TRACE_PREFIX} ${Behavior.id}`);
        for (const [label, value] of Object.entries(decisions)) {
          console.log(`${label}: ${String(value)}`);
        }
        console.groupEnd();
      }
      report.ran.push({
        id: Behavior.id,
        steps,
        ms: Date.now() - start,
        ...(error ? { error } : {}),
        ...(decisions !== undefined && { decisions }),
      });
      if (report.timedOut) break;
    }

    return report;
  }
}

export const runner = new BehaviorRunner();
