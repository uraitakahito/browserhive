/**
 * Behavior runtime types (BROWSER side).
 *
 * These run inside the captured page, not in Node. The whole `runtime/`
 * directory is excluded from the `tsc` build (see tsconfig.build.json) and
 * bundled into a single injectable script by `scripts/build-behaviors.mjs`
 * via esbuild. Do not import anything Node-specific here.
 */

/** A progress marker yielded by a behavior at each cooperative checkpoint. */
export interface BehaviorState {
  msg: string;
  counter?: string;
}

/** DOM helpers made available to behaviors as `ctx.Lib`. */
export interface BehaviorLib {
  sleep(ms: number): Promise<void>;
  /** Collect src / srcset (ALL candidates) / data-src / poster URLs into `out`. */
  collectCandidateUrls(el: Element, out: Set<string>): void;
  /** Collect `url(...)` targets from same-origin stylesheets into `out`. */
  collectStyleSheetUrls(out: Set<string>): void;
  scrollIntoView(el: Element): void;
}

/** Per-run context handed to a behavior's `run()`. */
export interface BehaviorCtx {
  Lib: BehaviorLib;
  /** Behavior-specific options (e.g. autoscroll `{ maxSteps, stepDelayMs }`). */
  opts: Record<string, unknown>;
  getState(msg: string, counter?: string): BehaviorState;
}

/** A behavior instance: an async generator that yields at each checkpoint. */
export interface Behavior {
  run(ctx: BehaviorCtx): AsyncGenerator<BehaviorState, void, void>;
}

/** A behavior class: static id / isMatch plus a zero-arg constructor. */
export interface BehaviorClass {
  id: string;
  isMatch(): boolean;
  new (): Behavior;
}

/** Options passed from Node into `__bh_behaviors.run()`. */
export interface RunOpts {
  /** Behavior ids to run, in execution order. */
  enabled: string[];
  /** Overall wall-clock budget; enforced at yield boundaries. */
  timeoutMs: number;
  /** Per-behavior options, keyed by behavior id. */
  options: Record<string, Record<string, unknown>>;
}

/** Report returned from `run()` back to Node (serialized via page.evaluate). */
export interface BehaviorRunReport {
  ran: Array<{ id: string; steps: number; ms: number; error?: string }>;
  timedOut: boolean;
}
