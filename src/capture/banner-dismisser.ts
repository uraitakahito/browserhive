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
  /** Minimum fraction of the viewport an overlay must cover to be removed. */
  minViewportCoverageRatio: number;
  /** Minimum computed `z-index` for an element to qualify as an overlay. */
  minZIndex: number;
}

export const DEFAULT_HEURISTIC_THRESHOLDS: HeuristicThresholds = {
  minViewportCoverageRatio: 0.3,
  minZIndex: 1000,
};

export interface DismissOptions {
  knownCmpEntries: readonly CmpEntry[];
  heuristic: HeuristicThresholds;
}

export const DEFAULT_DISMISS_OPTIONS: DismissOptions = {
  knownCmpEntries: KNOWN_CMP_ENTRIES,
  heuristic: DEFAULT_HEURISTIC_THRESHOLDS,
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

  // Pass 1: known CMP roots
  for (const entry of opts.knownCmpEntries) {
    const el = doc.querySelector(entry.selector);
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

  // Pass 2: heuristic overlay removal
  let removedOverlayCount = 0;
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

  return { framework, removedSelectors, removedOverlayCount };
};

/**
 * Browser-side wrapper. Serializes `runDismissalInDocument` and executes
 * it inside the page context, passing `document` and `window` from that
 * context plus serialized options.
 *
 * Banner dismissal is best-effort: any thrown error is swallowed and an
 * empty report is returned, so a malformed page cannot fail the capture.
 * Callers are responsible for surfacing the report (or the swallowed
 * error, via the optional `onError` hook) into their own logs.
 */
export const dismissBanners = async (
  page: Page,
  opts: DismissOptions = DEFAULT_DISMISS_OPTIONS,
  onError?: (error: unknown) => void,
): Promise<DismissReport> => {
  try {
    const source = `(${runDismissalInDocument.toString()})(document, window, ${JSON.stringify(opts)})`;
    const result: unknown = await page.evaluate(source);
    return result as DismissReport;
  } catch (error) {
    onError?.(error);
    return { ...EMPTY_DISMISS_REPORT };
  }
};
