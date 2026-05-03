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

export const noOperationalWorkersProblem = (): Problem => ({
  type: "about:blank",
  title: "No operational workers available",
  status: 503,
  detail:
    "The capture coordinator has no operational workers. Try again once at least one worker reconnects.",
});
