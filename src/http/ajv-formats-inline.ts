/**
 * Inline Ajv format validators.
 *
 * Replaces the `ajv-formats` package with a hand-rolled set scoped to the
 * formats actually referenced by `src/http/openapi.yaml`. Passed straight
 * into Fastify's `customOptions.formats`, so the type slot is Ajv's
 * native `Format` — no plugin-slot variance gymnastics required.
 *
 * Coverage is intentionally minimal: add to this map when (and only when)
 * a new `format:` keyword lands in the spec.
 */
import type { Format } from "ajv";

/**
 * Lax URI check. Mirrors what `ajv-formats`'s `uri` accepted (any
 * absolute URI scheme, including `mailto:`, `about:blank`, etc.) by
 * delegating to WHATWG `URL.canParse`. The application layer narrows
 * to http/https when it actually navigates.
 */
const isUri = (s: string): boolean => URL.canParse(s);

/**
 * UUID, version-agnostic. Generated server-side via `randomUUID()` so the
 * version nibble is always 4, but the regex stays loose to keep responses
 * round-trippable through future server changes.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 3339 / ISO 8601 timestamp. Crafted to accept the output of
 * `new Date().toISOString()` ("YYYY-MM-DDTHH:MM:SS.sssZ") and the common
 * `+HH:MM` offset variant. Fractional seconds and offset are optional.
 */
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const INLINE_FORMATS: Record<string, Format> = {
  uri: isUri,
  uuid: UUID_PATTERN,
  "date-time": DATE_TIME_PATTERN,
};
