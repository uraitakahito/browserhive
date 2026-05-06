/**
 * Reset-State Spec / Options
 *
 * Per-task control of the inter-task wipe performed by
 * `page-capturer.ts:resetPageState`. Mirrors the `dismissBanners` design
 * pattern: the HTTP layer accepts a flexible `boolean | ResetStateSpec`
 * shape, the request mapper resolves it against server-side defaults
 * (`CaptureConfig.resetPageState`), and the capture layer only ever sees a
 * fully-merged `ResetStateOptions`.
 *
 * Granularity rationale (two axes, not three)
 * -------------------------------------------
 *   - `cookies` — browser-scoped; cleared via CDP `Network.clearBrowserCookies`.
 *     Independent of any navigation.
 *   - `pageContext` — covers `page.goto("about:blank")`, which both tears
 *     down the JS execution context (closures / timers / listeners) AND
 *     drops origin-scoped storage (localStorage / sessionStorage / IndexedDB)
 *     because the next capture navigates to a different origin anyway. The
 *     two are therefore inseparable in practice and exposed as one knob.
 *
 * If neither field is true, `resetPageState` is a no-op and per-task
 * residue (cookies, in-flight timers, DOM listeners) carries over to the
 * next task. Useful for stateful crawls (post-login captures, multi-page
 * journeys against a single origin).
 */

/**
 * HTTP wire shape. Mirrors the OpenAPI `ResetStateSpec` schema. All fields
 * optional; the resolver fills omitted fields from the supplied defaults.
 */
export interface ResetStateSpec {
  cookies?: boolean;
  pageContext?: boolean;
}

/**
 * Resolved options consumed by `page-capturer.ts:resetPageState`. Every
 * field is required — the request-mapper boundary fills in defaults so the
 * capture layer never has to branch on undefined.
 */
export interface ResetStateOptions {
  cookies: boolean;
  pageContext: boolean;
}

export const DEFAULT_RESET_STATE_OPTIONS: ResetStateOptions = {
  cookies: true,
  pageContext: true,
};

/**
 * Translate the request-side `resetState` field into a fully-resolved
 * `ResetStateOptions`. Server-side defaults are passed in by the caller
 * (typically `CaptureConfig.resetPageState`) so per-server policy
 * (`--no-reset-cookies`, `BROWSERHIVE_RESET_PAGE_CONTEXT=false`, ...)
 * is the fallback when the request omits the field.
 *
 * Semantics:
 *   - `undefined`              → server defaults verbatim
 *   - `false`                  → `{ cookies: false, pageContext: false }`
 *   - `true`                   → `{ cookies: true, pageContext: true }`
 *   - `ResetStateSpec` object  → per-field `?? defaults`
 *
 * Note that `true` / `false` are absolute — they intentionally ignore
 * server defaults, so a request can fully restore the wipe even when the
 * server is configured to keep state, and vice versa.
 */
export const resolveResetStateSpec = (
  input: boolean | ResetStateSpec | undefined,
  defaults: ResetStateOptions,
): ResetStateOptions => {
  if (input === undefined) return { ...defaults };
  if (input === true) return { cookies: true, pageContext: true };
  if (input === false) return { cookies: false, pageContext: false };
  return {
    cookies: input.cookies ?? defaults.cookies,
    pageContext: input.pageContext ?? defaults.pageContext,
  };
};
