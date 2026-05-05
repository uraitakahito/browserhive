import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import type { Page } from "puppeteer";
import {
  CUSTOM_FRAMEWORK_LABEL,
  runDismissalInDocument,
  dismissBanners,
  resolveDismissSpec,
  EMPTY_DISMISS_REPORT,
  KNOWN_CMP_ENTRIES,
  DEFAULT_DISMISS_OPTIONS,
  DEFAULT_HEURISTIC_THRESHOLDS,
  type DismissOptions,
} from "../../src/capture/banner-dismisser.js";

/** Build a jsdom-backed (document, window) pair for the algorithm under test. */
const buildDom = (html: string): { doc: Document; win: Window } => {
  const dom = new JSDOM(html);
  return {
    doc: dom.window.document,
    win: dom.window as unknown as Window,
  };
};

/**
 * jsdom does not perform layout — `getBoundingClientRect()` returns zeros
 * for every element. Stub it on the elements that the heuristic should
 * pick up, leaving the rest untouched.
 */
const stubRect = (
  el: Element,
  rect: { width: number; height: number },
): void => {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: rect.height,
      right: rect.width,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }),
  });
};

describe("KNOWN_CMP_ENTRIES", () => {
  it("covers the major CMP frameworks", () => {
    const frameworks = new Set(KNOWN_CMP_ENTRIES.map((e) => e.framework));
    expect(frameworks).toContain("OneTrust");
    expect(frameworks).toContain("Cookiebot");
    expect(frameworks).toContain("Quantcast");
    expect(frameworks).toContain("Didomi");
    expect(frameworks).toContain("TrustArc");
    expect(frameworks).toContain("Sourcepoint");
  });

  it("contains only valid CSS selectors", () => {
    const { doc } = buildDom("<body></body>");
    for (const entry of KNOWN_CMP_ENTRIES) {
      // querySelector throws SyntaxError on invalid selectors; this asserts
      // every entry parses, even if no element matches.
      expect(() => doc.querySelector(entry.selector)).not.toThrow();
    }
  });
});

describe("runDismissalInDocument — pass 1 (CMP selectors)", () => {
  it("removes a OneTrust banner and reports the framework", () => {
    const { doc, win } = buildDom(`
      <body>
        <div id="onetrust-banner-sdk">cookie banner</div>
        <main>real content</main>
      </body>
    `);

    const report = runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(doc.querySelector("#onetrust-banner-sdk")).toBeNull();
    expect(doc.querySelector("main")).not.toBeNull();
    expect(report.framework).toBe("OneTrust");
    expect(report.removedSelectors).toContain("#onetrust-banner-sdk");
  });

  it("removes a Cookiebot dialog + underlay and reports both selectors", () => {
    const { doc, win } = buildDom(`
      <body>
        <div id="CybotCookiebotDialog">dialog</div>
        <div id="CybotCookiebotDialogBodyUnderlay">underlay</div>
        <p>content</p>
      </body>
    `);

    const report = runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(doc.querySelector("#CybotCookiebotDialog")).toBeNull();
    expect(doc.querySelector("#CybotCookiebotDialogBodyUnderlay")).toBeNull();
    expect(report.framework).toBe("Cookiebot");
    expect(report.removedSelectors).toHaveLength(2);
  });

  it("matches Sourcepoint's prefix-suffixed id", () => {
    const { doc, win } = buildDom(`
      <body>
        <div id="sp_message_container_12345">sourcepoint</div>
      </body>
    `);

    const report = runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(doc.querySelector('[id^="sp_message_container"]')).toBeNull();
    expect(report.framework).toBe("Sourcepoint");
  });

  it("attributes framework to the first match across multiple frameworks", () => {
    // KNOWN_CMP_ENTRIES has OneTrust before Cookiebot, so OneTrust wins.
    const { doc, win } = buildDom(`
      <body>
        <div id="onetrust-banner-sdk">a</div>
        <div id="CybotCookiebotDialog">b</div>
      </body>
    `);

    const report = runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(report.framework).toBe("OneTrust");
    expect(report.removedSelectors).toContain("#onetrust-banner-sdk");
    expect(report.removedSelectors).toContain("#CybotCookiebotDialog");
  });

  it("releases body/html overflow lock that banners add", () => {
    const { doc, win } = buildDom(`
      <html style="overflow: hidden">
        <body style="overflow: hidden">
          <div id="onetrust-banner-sdk"></div>
        </body>
      </html>
    `);

    runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(doc.body.style.overflow).toBe("");
    expect(doc.documentElement.style.overflow).toBe("");
  });

  it("returns an empty report when no banners are present", () => {
    const { doc, win } = buildDom(`
      <body><main>only content</main></body>
    `);

    const report = runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(report.framework).toBeNull();
    expect(report.removedSelectors).toEqual([]);
    expect(report.removedOverlayCount).toBe(0);
  });
});

describe("runDismissalInDocument — pass 2 (heuristic overlays)", () => {
  // Use empty CMP list so we isolate the heuristic.
  const heuristicOnly: DismissOptions = {
    knownCmpEntries: [],
    heuristic: DEFAULT_HEURISTIC_THRESHOLDS,
  };

  it("removes a fixed overlay covering most of the viewport", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="evil-overlay" style="position: fixed; z-index: 9999"></div>
        <main>content</main>
      </body>
    `);
    const overlay = doc.querySelector(".evil-overlay");
    expect(overlay).not.toBeNull();
    stubRect(overlay!, { width: win.innerWidth, height: win.innerHeight });

    const report = runDismissalInDocument(doc, win, heuristicOnly);

    expect(doc.querySelector(".evil-overlay")).toBeNull();
    expect(doc.querySelector("main")).not.toBeNull();
    expect(report.framework).toBe("heuristic");
    expect(report.removedOverlayCount).toBe(1);
  });

  it("removes a sticky overlay that meets the threshold", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="sticky-overlay" style="position: sticky; z-index: 5000"></div>
      </body>
    `);
    stubRect(doc.querySelector(".sticky-overlay")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });

    const report = runDismissalInDocument(doc, win, heuristicOnly);

    expect(report.removedOverlayCount).toBe(1);
  });

  it("does not remove fixed elements with low z-index", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="low-z" style="position: fixed; z-index: 10"></div>
      </body>
    `);
    stubRect(doc.querySelector(".low-z")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });

    const report = runDismissalInDocument(doc, win, heuristicOnly);

    expect(report.removedOverlayCount).toBe(0);
    expect(doc.querySelector(".low-z")).not.toBeNull();
  });

  it("does not remove fixed elements that are too small", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="tiny-toast" style="position: fixed; z-index: 9999"></div>
      </body>
    `);
    // 100 × 50 = 5000 px². Viewport ~786432 px². Ratio < 0.3.
    stubRect(doc.querySelector(".tiny-toast")!, { width: 100, height: 50 });

    const report = runDismissalInDocument(doc, win, heuristicOnly);

    expect(report.removedOverlayCount).toBe(0);
    expect(doc.querySelector(".tiny-toast")).not.toBeNull();
  });

  it("does not remove non-fixed elements regardless of size", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="huge-static" style="position: static; z-index: 9999"></div>
      </body>
    `);
    stubRect(doc.querySelector(".huge-static")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });

    const report = runDismissalInDocument(doc, win, heuristicOnly);

    expect(report.removedOverlayCount).toBe(0);
  });

  it("skips elements inside semantic landmarks (header/footer/nav/main/aside)", () => {
    const { doc, win } = buildDom(`
      <body>
        <header>
          <div class="header-overlay" style="position: fixed; z-index: 9999"></div>
        </header>
        <main>
          <div class="main-overlay" style="position: fixed; z-index: 9999"></div>
        </main>
        <footer>
          <div class="footer-overlay" style="position: sticky; z-index: 9999"></div>
        </footer>
      </body>
    `);
    stubRect(doc.querySelector(".header-overlay")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });
    stubRect(doc.querySelector(".main-overlay")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });
    stubRect(doc.querySelector(".footer-overlay")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });

    const report = runDismissalInDocument(doc, win, heuristicOnly);

    expect(report.removedOverlayCount).toBe(0);
    expect(doc.querySelector(".header-overlay")).not.toBeNull();
    expect(doc.querySelector(".main-overlay")).not.toBeNull();
    expect(doc.querySelector(".footer-overlay")).not.toBeNull();
  });

  it("respects custom thresholds", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="medium-overlay" style="position: fixed; z-index: 500"></div>
      </body>
    `);
    stubRect(doc.querySelector(".medium-overlay")!, {
      width: win.innerWidth / 2,
      height: win.innerHeight / 2,
    });
    // Default threshold (0.3 coverage, 1000 z-index) → would NOT match.
    // Custom threshold (0.2 coverage, 100 z-index) → matches.
    const lenient: DismissOptions = {
      knownCmpEntries: [],
      heuristic: { enabled: true, minViewportCoverageRatio: 0.2, minZIndex: 100 },
    };

    const reportStrict = runDismissalInDocument(
      doc,
      win,
      heuristicOnly,
    );
    expect(reportStrict.removedOverlayCount).toBe(0);

    const reportLenient = runDismissalInDocument(doc, win, lenient);
    expect(reportLenient.removedOverlayCount).toBe(1);
  });
});

describe("runDismissalInDocument — combined passes", () => {
  it("counts CMP and heuristic removals separately", () => {
    const { doc, win } = buildDom(`
      <body>
        <div id="onetrust-banner-sdk"></div>
        <div class="rogue-overlay" style="position: fixed; z-index: 9999"></div>
      </body>
    `);
    stubRect(doc.querySelector(".rogue-overlay")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });

    const report = runDismissalInDocument(doc, win, DEFAULT_DISMISS_OPTIONS);

    expect(report.removedSelectors).toEqual(["#onetrust-banner-sdk"]);
    expect(report.removedOverlayCount).toBe(1);
    // First match wins for the framework label.
    expect(report.framework).toBe("OneTrust");
  });
});

describe("runDismissalInDocument — per-selector resilience", () => {
  it("skips an invalid selector and continues with the rest", () => {
    const { doc, win } = buildDom(`
      <body>
        <div id="onetrust-banner-sdk">consent</div>
      </body>
    `);
    const opts: DismissOptions = {
      knownCmpEntries: [
        // querySelector throws SyntaxError on this — must be swallowed.
        { framework: "custom", selector: "[" },
        { framework: "OneTrust", selector: "#onetrust-banner-sdk" },
      ],
      heuristic: { ...DEFAULT_HEURISTIC_THRESHOLDS, enabled: false },
    };

    const report = runDismissalInDocument(doc, win, opts);

    expect(report.removedSelectors).toEqual(["#onetrust-banner-sdk"]);
    expect(report.framework).toBe("OneTrust");
  });
});

describe("runDismissalInDocument — heuristic.enabled", () => {
  it("skips pass 2 entirely when heuristic.enabled is false", () => {
    const { doc, win } = buildDom(`
      <body>
        <div class="rogue-overlay" style="position: fixed; z-index: 9999;"></div>
      </body>
    `);
    stubRect(doc.querySelector(".rogue-overlay")!, {
      width: win.innerWidth,
      height: win.innerHeight,
    });

    const opts: DismissOptions = {
      knownCmpEntries: [],
      heuristic: { enabled: false, minViewportCoverageRatio: 0.3, minZIndex: 1000 },
    };

    const report = runDismissalInDocument(doc, win, opts);

    expect(report.removedOverlayCount).toBe(0);
    expect(doc.querySelector(".rogue-overlay")).not.toBeNull();
    expect(report.framework).toBeNull();
  });
});

describe("resolveDismissSpec", () => {
  it("returns undefined for undefined / false (no dismissal pass)", () => {
    expect(resolveDismissSpec(undefined)).toBeUndefined();
    expect(resolveDismissSpec(false)).toBeUndefined();
  });

  it("returns DEFAULT_DISMISS_OPTIONS for true", () => {
    expect(resolveDismissSpec(true)).toBe(DEFAULT_DISMISS_OPTIONS);
  });

  it("returns the curated list when given an empty spec object", () => {
    const opts = resolveDismissSpec({});
    expect(opts).toBeDefined();
    expect(opts?.knownCmpEntries).toEqual(KNOWN_CMP_ENTRIES);
    expect(opts?.heuristic).toEqual(DEFAULT_HEURISTIC_THRESHOLDS);
  });

  it("appends extraSelectors as custom-framework entries", () => {
    const opts = resolveDismissSpec({
      extraSelectors: ["#paywall", ".takeover"],
    });
    expect(opts?.knownCmpEntries.length).toBe(KNOWN_CMP_ENTRIES.length + 2);
    expect(opts?.knownCmpEntries.slice(-2)).toEqual([
      { framework: CUSTOM_FRAMEWORK_LABEL, selector: "#paywall" },
      { framework: CUSTOM_FRAMEWORK_LABEL, selector: ".takeover" },
    ]);
  });

  it("filters out frameworks listed in excludeFrameworks", () => {
    const opts = resolveDismissSpec({
      excludeFrameworks: ["OneTrust", "TrustArc"],
    });
    const frameworks = new Set(opts?.knownCmpEntries.map((e) => e.framework));
    expect(frameworks.has("OneTrust")).toBe(false);
    expect(frameworks.has("TrustArc")).toBe(false);
    expect(frameworks.has("Cookiebot")).toBe(true);
  });

  it("drops the curated list entirely when useDefaults is false", () => {
    const opts = resolveDismissSpec({
      useDefaults: false,
      extraSelectors: ["#only"],
    });
    expect(opts?.knownCmpEntries).toEqual([
      { framework: CUSTOM_FRAMEWORK_LABEL, selector: "#only" },
    ]);
  });

  it("merges heuristic fields field-by-field with defaults", () => {
    const opts = resolveDismissSpec({
      heuristic: { minZIndex: 50 },
    });
    expect(opts?.heuristic).toEqual({
      enabled: true,
      minViewportCoverageRatio: 0.3,
      minZIndex: 50,
    });
  });

  it("propagates heuristic.enabled: false", () => {
    const opts = resolveDismissSpec({ heuristic: { enabled: false } });
    expect(opts?.heuristic.enabled).toBe(false);
    expect(opts?.heuristic.minViewportCoverageRatio).toBe(0.3);
  });
});

describe("dismissBanners — Layer A timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns EMPTY_DISMISS_REPORT and invokes onError when page.evaluate hangs", async () => {
    const onError = vi.fn();
    const mockPage = {
      evaluate: vi.fn().mockReturnValue(
        new Promise<never>(() => {
          /* never resolves — simulates page mid-navigation */
        }),
      ),
    } as unknown as Page;

    const reportPromise = dismissBanners(mockPage, DEFAULT_DISMISS_OPTIONS, onError);

    // DISMISS_EVALUATE_TIMEOUT_MS = 5_000 in banner-dismisser.ts
    await vi.advanceTimersByTimeAsync(5_001);

    const report = await reportPromise;
    expect(report).toEqual(EMPTY_DISMISS_REPORT);
    expect(onError).toHaveBeenCalledTimes(1);
    const onErrorArg: unknown = onError.mock.calls[0]?.[0];
    expect(onErrorArg).toBeInstanceOf(Error);
    expect((onErrorArg as Error).message).toContain("Banner dismissal evaluate");
  });
});
