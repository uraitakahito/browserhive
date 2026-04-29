/**
 * Result Type
 *
 * A discriminated union for representing either success or failure values.
 * Used throughout the codebase to make error paths explicit and avoid
 * losing detail through generic `throw new Error(...)`.
 */

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
  result: Result<T, E>,
): result is { ok: true; value: T } => result.ok;

export const isErr = <T, E>(
  result: Result<T, E>,
): result is { ok: false; error: E } => !result.ok;
