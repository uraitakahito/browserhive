/**
 * Coordinator Error Types
 *
 * Structured failure shapes returned (as Result errors) from coordinator
 * lifecycle actors. Replaces the previous pattern of throwing Error with
 * embedded format strings, which lost detail across XState's onError edge.
 */
import type { ErrorDetails } from "./types.js";

/** Failure outcome of `initializeWorkers` */
export type WorkerInitFailure =
  | { kind: "no-profiles" }
  | {
      kind: "partial-failure";
      operational: number;
      total: number;
      failed: { browserURL: string; reason: ErrorDetails }[];
    };
