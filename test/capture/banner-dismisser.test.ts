import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  runDismissalInDocument,
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
      heuristic: { minViewportCoverageRatio: 0.2, minZIndex: 100 },
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
