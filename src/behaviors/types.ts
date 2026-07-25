/**
 * Behavior types (NODE side). Node-safe — no browser globals. The in-page
 * counterparts live in `runtime/types.ts` (excluded from the tsc build).
 */

/** A client-supplied custom behavior: `source` is a class *expression*. */
export interface CustomBehavior {
  id: string;
  /** A JS class expression implementing { static id, static isMatch, run(ctx) }. */
  source: string;
}

/** Server-wide behavior configuration (from CLI / env / defaults). */
export interface BehaviorConfig {
  /** Built-in behavior ids enabled by default, in execution order. */
  builtins: string[];
  /** Overall wall-clock budget for the whole behavior pass (ms). */
  timeoutMs: number;
  /** Whether client-supplied `custom` behaviors are accepted. */
  allowCustom: boolean;
  /** Per-behavior options, keyed by behavior id. */
  options: Record<string, Record<string, unknown>>;
  /** Best-effort `waitForNetworkIdle` after behaviors so late fetches land. */
  idleTimeMs: number;
  idleTimeoutMs: number;
}

/** Per-request override, normalized from the HTTP `behaviors` field. */
export interface BehaviorRequest {
  /** Replaces the server default enabled set for this task. */
  builtins?: string[];
  /** Per-behavior option overrides, merged over the server options. */
  options?: Record<string, Record<string, unknown>>;
  /** Client-supplied custom behaviors (only used when `allowCustom`). */
  custom?: CustomBehavior[];
}

/** Report returned from the in-page runner, surfaced in the capture result. */
export interface BehaviorRunReport {
  ran: { id: string; steps: number; ms: number; error?: string }[];
  timedOut: boolean;
}
