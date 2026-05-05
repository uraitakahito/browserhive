/**
 * Banner / Modal Dismisser
 *
 * Removes cookie consent banners, newsletter popups, and other overlay
 * elements that obscure the page content prior to capture. Works in two
 * passes:
 *
 *   1. Known CMP selectors — exact `querySelector` match against a curated
 *      list of consent-management-platform root elements.
 *   2. Heuristic overlays — fixed/sticky elements with high z-index that
 *      cover a significant fraction of the viewport, excluding semantic
 *      landmarks (header/footer/nav/main/aside).
 *
 * The core algorithm (`runDismissalInDocument`) takes an explicit
 * `Document` / `Window` so it can be unit-tested directly with jsdom.
 * The browser-side wrapper (`dismissBanners`) serializes the function
 * via `Function.prototype.toString` and runs it inside the page context
 * with the page's own document/window. The algorithm therefore must
 * remain self-contained — it cannot reference any closure variables.
 */
import type { Page } from "puppeteer";
import { withTimeout } from "./page-capturer.js";

/**
 * Upper bound for the in-page dismissal `page.evaluate`. The serialized
 * script does pure DOM walking and removal — no I/O — so a healthy page
 * completes in milliseconds. The same execution-context-await hazard that
 * justifies Layer A timeouts in `PageCapturer.capture` applies here: if
 * the page is mid-navigation (e.g. a CMP that immediately redirects on
 * accept), `page.evaluate` blocks until the new context is established,
 * which may be never.
 */
const DISMISS_EVALUATE_TIMEOUT_MS = 5_000;

export interface CmpEntry {
  framework: string;
  selector: string;
}

/**
 * Curated list of consent-management-platform (CMP) root selectors.
 * Order matters only for which framework label we attribute the dismissal
 * to in the report — every matching selector is removed regardless.
 */
export const KNOWN_CMP_ENTRIES: readonly CmpEntry[] = [
  // OneTrust (very common; banner + preference center + underlay)
  { framework: "OneTrust", selector: "#onetrust-banner-sdk" },
  { framework: "OneTrust", selector: "#onetrust-consent-sdk" },
  { framework: "OneTrust", selector: "#onetrust-pc-sdk" },
  { framework: "OneTrust", selector: ".onetrust-pc-dark-filter" },

  // Cookiebot
  { framework: "Cookiebot", selector: "#CybotCookiebotDialog" },
  { framework: "Cookiebot", selector: "#CybotCookiebotDialogBodyUnderlay" },

  // Quantcast Choice
  { framework: "Quantcast", selector: ".qc-cmp2-container" },

  // Didomi
  { framework: "Didomi", selector: "#didomi-popup" },
  { framework: "Didomi", selector: ".didomi-popup-container" },
  { framework: "Didomi", selector: "#didomi-host" },

  // TrustArc
  { framework: "TrustArc", selector: "#truste-consent-track" },
  { framework: "TrustArc", selector: ".truste_box_overlay" },
  { framework: "TrustArc", selector: "#consent_blackbar" },

  // Sourcepoint (id is suffixed with a numeric instance, hence prefix match)
  { framework: "Sourcepoint", selector: '[id^="sp_message_container"]' },

  // Osano
  { framework: "Osano", selector: ".osano-cm-window" },

  // Cookie Law Info (WordPress plugin)
  { framework: "CookieLawInfo", selector: "#cookie-law-info-bar" },

  // Insites Cookie Consent
  { framework: "InsitesCookieConsent", selector: ".cc-window" },

  // Klaro
  { framework: "Klaro", selector: ".klaro" },

  // Usercentrics
  { framework: "Usercentrics", selector: "#usercentrics-root" },
];

export interface HeuristicThresholds {
  /** When false, pass 2 (the size/z-index heuristic) is skipped entirely. */
  enabled: boolean;
  /** Minimum fraction of the viewport an overlay must cover to be removed. */
  minViewportCoverageRatio: number;
  /** Minimum computed `z-index` for an element to qualify as an overlay. */
  minZIndex: number;
}

export const DEFAULT_HEURISTIC_THRESHOLDS: HeuristicThresholds = {
  enabled: true,
  minViewportCoverageRatio: 0.3,
  minZIndex: 1000,
};

export interface DismissOptions {
  knownCmpEntries: readonly CmpEntry[];
  heuristic: HeuristicThresholds;
  /**
   * When `true`, dismissal failures (in-page evaluate timeout, the
   * `page.evaluate` promise rejecting, or a per-selector `querySelector`
   * SyntaxError) propagate as exceptions instead of being swallowed into
   * an empty report. Default `false` preserves the long-standing
   * best-effort contract.
   *
   * The inner `runDismissalInDocument` reads this on the per-selector
   * skip path, and the outer `dismissBanners` reads it on the main catch
   * — together they cover both the "page hung the evaluate" and the
   * "user typo'd a selector" cases with a single flag.
   */
  failOnError: boolean;
}

export const DEFAULT_DISMISS_OPTIONS: DismissOptions = {
  knownCmpEntries: KNOWN_CMP_ENTRIES,
  heuristic: DEFAULT_HEURISTIC_THRESHOLDS,
  failOnError: false,
};

/**
 * Inline-spec shape received from the HTTP layer. Mirrors the OpenAPI
 * `DismissSpec` schema. All fields are optional; the resolver fills in
 * server-side defaults below.
 *
 * Kept structurally identical to the generated `DismissSpec` type so
 * `request-mapper.ts` can pass the request body in directly.
 */
export interface DismissSpec {
  useDefaults?: boolean;
  extraSelectors?: string[];
  excludeFrameworks?: string[];
  heuristic?: {
    enabled?: boolean;
    minViewportCoverageRatio?: number;
    minZIndex?: number;
  };
  failOnError?: boolean;
}

/** Internal label attributed to `extraSelectors` matches in the report. */
export const CUSTOM_FRAMEWORK_LABEL = "custom";

/**
 * Translate the request-side `dismissBanners` field into a fully-resolved
 * `DismissOptions` (or `undefined` when dismissal should be skipped).
 *
 * Semantics:
 *   - `undefined` / `false`           → `undefined` (no dismissal pass at all)
 *   - `true`                          → `DEFAULT_DISMISS_OPTIONS` (curated CMP list + default heuristic)
 *   - `{}` / `DismissSpec` object     → defaults filled in field-by-field
 *
 * Merge rules for the spec object:
 *   - `useDefaults` defaults to `true`. When `true`, `KNOWN_CMP_ENTRIES`
 *     minus any framework named in `excludeFrameworks` is included.
 *   - `extraSelectors` is concatenated as `{ framework: "custom", selector }`
 *     entries — visible in `dismissReport.removedSelectors` and tagged so
 *     callers can distinguish a custom hit from a default-CMP hit.
 *   - `heuristic` fields fall back to `DEFAULT_HEURISTIC_THRESHOLDS` per-field.
 *   - `failOnError` defaults to `false` (best-effort). The boolean
 *     short form (`true`) intentionally maps to `failOnError: false` —
 *     strict mode requires the inline object form.
 */
export const resolveDismissSpec = (
  input: boolean | DismissSpec | undefined,
): DismissOptions | undefined => {
  if (input === undefined || input === false) return undefined;
  if (input === true) return DEFAULT_DISMISS_OPTIONS;

  const useDefaults = input.useDefaults ?? true;
  const excluded = new Set(input.excludeFrameworks ?? []);
  const baseEntries: readonly CmpEntry[] = useDefaults
    ? KNOWN_CMP_ENTRIES.filter((e) => !excluded.has(e.framework))
    : [];
  const customEntries: CmpEntry[] = (input.extraSelectors ?? []).map(
    (selector) => ({ framework: CUSTOM_FRAMEWORK_LABEL, selector }),
  );

  const h = input.heuristic ?? {};
  const heuristic: HeuristicThresholds = {
    enabled: h.enabled ?? DEFAULT_HEURISTIC_THRESHOLDS.enabled,
    minViewportCoverageRatio:
      h.minViewportCoverageRatio ??
      DEFAULT_HEURISTIC_THRESHOLDS.minViewportCoverageRatio,
    minZIndex: h.minZIndex ?? DEFAULT_HEURISTIC_THRESHOLDS.minZIndex,
  };

  return {
    knownCmpEntries: [...baseEntries, ...customEntries],
    heuristic,
    failOnError: input.failOnError ?? false,
  };
};

export interface DismissReport {
  /** First framework that matched, or "heuristic", or null if nothing fired. */
  framework: string | null;
  /** CSS selectors whose elements were removed in pass 1. */
  removedSelectors: string[];
  /** Number of overlays removed by pass 2 (heuristic). */
  removedOverlayCount: number;
}

/** Empty report used as a fallback when dismissal fails or is skipped. */
export const EMPTY_DISMISS_REPORT: DismissReport = {
  framework: null,
  removedSelectors: [],
  removedOverlayCount: 0,
};

/**
 * Pure dismissal algorithm. Receives a `Document` and `Window` explicitly
 * so it can be exercised directly under jsdom in unit tests. Self-contained
 * by design: must not reference any outer-scope identifier, since this
 * function is serialized via `Function.prototype.toString` when handed
 * to `page.evaluate` from the browser-side wrapper.
 */
export const runDismissalInDocument = (
  doc: Document,
  win: Window,
  opts: DismissOptions,
): DismissReport => {
  let framework: string | null = null;
  const removedSelectors: string[] = [];

  // Pass 1: known CMP roots.
  // Each selector is tried in its own try-catch so that one invalid entry
  // (typo in `extraSelectors`, or a CMP whose selector syntax has drifted)
  // cannot block the rest. `querySelector` throws SyntaxError on a malformed
  // selector — we treat that as "this entry didn't match" and continue.
  // When the caller opts into strict mode (`failOnError: true`) we re-throw
  // instead, so a typo in a custom selector becomes a hard capture failure
  // via the page.evaluate reject path back to the outer `dismissBanners`.
  for (const entry of opts.knownCmpEntries) {
    let el: Element | null;
    try {
      el = doc.querySelector(entry.selector);
    } catch (error) {
      if (opts.failOnError) throw error;
      continue;
    }
    if (el?.parentNode) {
      el.parentNode.removeChild(el);
      removedSelectors.push(entry.selector);
      framework ??= entry.framework;
    }
  }

  // Banners commonly add `overflow: hidden` to <body>/<html> to lock scroll.
  // Releasing it prevents the captured screenshot from being clipped.
  doc.body.style.removeProperty("overflow");
  doc.documentElement.style.removeProperty("overflow");

  // Pass 2: heuristic overlay removal. Skipped entirely when the caller
  // disables the pass — most often when the curated CMP list is enough and
  // the heuristic is producing false positives on a specific page.
  let removedOverlayCount = 0;
  if (opts.heuristic.enabled) {
    const viewportArea = win.innerWidth * win.innerHeight;
    if (viewportArea > 0) {
      const all = Array.from(doc.body.querySelectorAll<HTMLElement>("*"));
      for (const el of all) {
        if (!doc.body.contains(el)) continue;

        // Skip semantic landmarks and anything inside one — real chrome.
        if (el.closest("header, footer, nav, main, aside")) continue;

        const style = win.getComputedStyle(el);
        const position = style.position;
        if (position !== "fixed" && position !== "sticky") continue;

        const zIndex = parseInt(style.zIndex, 10);
        if (Number.isNaN(zIndex) || zIndex < opts.heuristic.minZIndex) continue;

        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area / viewportArea < opts.heuristic.minViewportCoverageRatio) continue;

        el.parentNode?.removeChild(el);
        removedOverlayCount += 1;
        framework ??= "heuristic";
      }
    }
  }

  return { framework, removedSelectors, removedOverlayCount };
};

/**
 * Browser-side wrapper. Serializes `runDismissalInDocument` and executes
 * it inside the page context, passing `document` and `window` from that
 * context plus serialized options.
 *
 * Default (`opts.failOnError === false`): best-effort. Any thrown error
 * is swallowed and an empty report is returned, so a malformed page or a
 * typo in `extraSelectors` cannot fail the capture. Callers are
 * responsible for surfacing the report (or the swallowed error via the
 * optional `onError` hook) into their own logs.
 *
 * Strict (`opts.failOnError === true`): the same errors are re-thrown
 * after `onError` is invoked, so the calling capture pipeline classifies
 * the failure (timeout / internal / connection) and the worker reports
 * the task as failed. Use this when a missing banner-dismiss invalidates
 * the captured artifact for the downstream pipeline.
 *
 * Intentionally NOT routed through `page-capturer.ts:runOnStableContext`:
 * spending up to 24s retrying CMP detection on a JS-redirecting page that
 * has no banner anyway is the wrong trade-off. A destroyed-context throw
 * here simply collapses to an empty `DismissReport` (or propagates in
 * strict mode), which is the same outcome as "no CMP matched" for the
 * default best-effort path.
 */
export const dismissBanners = async (
  page: Page,
  opts: DismissOptions = DEFAULT_DISMISS_OPTIONS,
  onError?: (error: unknown) => void,
): Promise<DismissReport> => {
  try {
    const source = `(${runDismissalInDocument.toString()})(document, window, ${JSON.stringify(opts)})`;
    // Bounded by DISMISS_EVALUATE_TIMEOUT_MS — a hung evaluate (page
    // mid-navigation, no fresh execution context) is swallowed by the
    // catch below and surfaces as EMPTY_DISMISS_REPORT in best-effort
    // mode, or rethrown as a TimeoutError in strict mode.
    const result: unknown = await withTimeout(
      page.evaluate(source),
      DISMISS_EVALUATE_TIMEOUT_MS,
      "Banner dismissal evaluate"
    );
    return result as DismissReport;
  } catch (error) {
    onError?.(error);
    if (opts.failOnError) throw error;
    return { ...EMPTY_DISMISS_REPORT };
  }
};
