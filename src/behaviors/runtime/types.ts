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

/**
 * What a behavior decided, reported once when it finishes.
 *
 * Distinct from the progress a behavior `yield`s: progress says how far along
 * it is, a decision says what it concluded and why. `autoscroll` stopping is
 * the clearest case — reaching the bottom and running out of steps look
 * identical from outside, but only one of them means the page was fully
 * covered.
 */
export interface BehaviorDecisions {
  [label: string]: string | number | boolean;
}

/**
 * A behavior instance: an async generator that yields at each checkpoint and
 * *returns* what it decided.
 */
export interface Behavior {
  run(ctx: BehaviorCtx): AsyncGenerator<BehaviorState, BehaviorDecisions | void, void>;
}

/** A behavior class: static id / isMatch plus a zero-arg constructor. */
export interface BehaviorClass {
  id: string;
  isMatch(): boolean;
  /**
   * Site behaviors are considered on every capture without being listed in
   * `enabled` — `isMatch()`, which gates on the host, is what decides whether
   * they run. Built-ins are the opposite: opted into by id via `--behaviors`.
   *
   * That difference is why this is a flag on the class rather than a naming
   * convention on `id`: the runner needs to know the kind, not parse a prefix.
   */
  siteSpecific?: boolean;
  new (): Behavior;
}

/** Options passed from Node into `__bh_behaviors.run()`. */
export interface RunOpts {
  /** Behavior ids to run, in execution order. */
  enabled: string[];
  /**
   * Whether the bundled site behaviors are considered. Defaults to on when
   * omitted; set false to capture with built-ins (and client custom behaviors)
   * only — useful when comparing runs or reproducing an older archive.
   */
  siteBehaviors?: boolean;
  /** Overall wall-clock budget; enforced at yield boundaries. */
  timeoutMs: number;
  /** Per-behavior options, keyed by behavior id. */
  options: Record<string, Record<string, unknown>>;
  /**
   * Log each behavior's decisions to the page console. Off unless the capture
   * asked for a trace; see `CaptureConfig.trace`.
   */
  trace?: boolean;
}

/**
 * Report returned from `run()` back to Node (serialized via page.evaluate).
 *
 * Declared twice on purpose: `src/behaviors/types.ts` holds the Node-side
 * copy, and this directory is excluded from the tsc build so it cannot import
 * it. The two must be kept in step by hand — `test/behaviors/report-shape.test.ts`
 * fails if they drift, because a field added on one side alone crosses
 * `page.evaluate` and then vanishes into an `any`.
 */
export interface BehaviorRunReport {
  ran: Array<{
    id: string;
    steps: number;
    ms: number;
    error?: string;
    /** What the behavior concluded. See the Node-side copy for why. */
    decisions?: Record<string, string | number | boolean>;
  }>;
  timedOut: boolean;
}
