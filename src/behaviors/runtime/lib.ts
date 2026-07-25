/**
 * DOM helper library exposed to behaviors as `ctx.Lib` (BROWSER side).
 */
import type { BehaviorLib } from "./types";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toAbsolute = (url: string, base?: string): string | null => {
  try {
    return new URL(url, base ?? document.baseURI).href;
  } catch {
    return null;
  }
};

/**
 * Collect every fetchable image URL a responsive element can reference —
 * `src`, all `srcset` candidates (1x AND 2x AND every width), `data-src` /
 * `data-srcset` lazy attributes, and `poster`. This is what makes the archive
 * DPR/viewport-complete: a 1280px, DPR-1 capture only *requests* the candidate
 * for its own conditions, so autofetch fetches the rest so Retina replay (which
 * requests `_2x`) finds them.
 */
const collectCandidateUrls = (el: Element, out: Set<string>): void => {
  const push = (u: string | null): void => {
    const abs = u && toAbsolute(u);
    if (abs) out.add(abs);
  };
  for (const attr of ["src", "data-src", "data-lazy-src", "poster"]) {
    const v = el.getAttribute(attr);
    if (v) push(v);
  }
  for (const attr of ["srcset", "data-srcset"]) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    // "url 1x, url 2x, url 480w" -> take the URL from each comma-separated candidate
    for (const candidate of v.split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) push(url);
    }
  }
};

const collectStyleSheetUrls = (out: Set<string>): void => {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules; // throws on cross-origin sheets -> skip
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const css = (rule as CSSRule).cssText || "";
      for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        const abs = toAbsolute(m[2], sheet.href ?? undefined);
        if (abs && !abs.startsWith("data:")) out.add(abs);
      }
    }
  }
};

const scrollIntoView = (el: Element): void => {
  (el as HTMLElement).scrollIntoView?.({ block: "center" });
};

export const Lib: BehaviorLib = {
  sleep,
  collectCandidateUrls,
  collectStyleSheetUrls,
  scrollIntoView,
};
