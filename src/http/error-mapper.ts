/**
 * Error Mapper (Outbound)
 *
 * Constructs RFC 7807 Problem Details bodies from internal failure modes.
 * The HTTP layer reports validation/coordinator state failures via these
 * bodies (Content-Type: application/problem+json) instead of using a
 * `{ accepted: false, error }` envelope on the success path.
 */
import type { Problem } from "./generated/index.js";

export const validationProblem = (detail: string): Problem => ({
  type: "about:blank",
  title: "Validation failed",
  status: 400,
  detail,
});

export const duplicateUrlProblem = (detail: string): Problem => ({
  type: "about:blank",
  title: "Duplicate URL",
  status: 409,
  detail,
});

/**
 * Deliberately conflates "never submitted" with "evicted from the result
 * cache": once a result ages out, the server no longer holds what it would
 * need to tell the two apart. Saying so in `detail` keeps a client from
 * reading 404 as proof the task never existed.
 */
export const unknownTaskProblem = (taskId: string): Problem => ({
  type: "about:blank",
  title: "Unknown task",
  status: 404,
  detail: `No cached result for task ${taskId}. It was never submitted, or its result aged out of the result cache — read the .result.json manifest in the artifact store for the durable record.`,
});

export const noOperationalWorkersProblem = (): Problem => ({
  type: "about:blank",
  title: "No operational workers available",
  status: 503,
  detail:
    "The capture coordinator has no operational workers. Try again once at least one worker reconnects.",
});
