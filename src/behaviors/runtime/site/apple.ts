/**
 * Site behavior: apple.com — back-fill the TV+ gallery's other image variant.
 *
 * apple renders the gallery slides as plain `<img>` with **no `srcset`**: the
 * URL is an mzstatic resize path (`…/image/thumb/<token>/<W>x<H>sr.jpg`) whose
 * W×H apple's JS computes from `devicePixelRatio` at render time. Probing the
 * real capture browser showed DPR 1 → `980x522` and DPR 2 → `1960x1044`. Only
 * the variant for the DPR we captured at is ever referenced, so the other one
 * cannot be reached by `autofetch` (which scans what the live DOM references)
 * and a replay at the opposite DPR shows a black slide.
 *
 * This behavior re-fetches the document HTML — the SSR markup still lists
 * variants the hydrated DOM has collapsed away — and, for every mzstatic resize
 * URL it can see, also fetches the doubled and halved siblings. The bytes flow
 * through the CDP recorder, so they land in the WACZ.
 *
 * Honest limit: at DPR 2 the built-ins already archive the 2x on their own, and
 * the 1x is not reliably reachable by the time behaviors run. `archiveMode:
 * multipass` is what guarantees both variants; this is the best-effort pass.
 */
import type { BehaviorCtx, BehaviorState, BehaviorDecisions } from "../types";

/** mzstatic resize URLs end in `/<W>x<H><suffix>` — that is what we rescale. */
const RESIZE_PATH = /\/(\d{2,4})x(\d{2,4})([^/]*)$/;
const IMAGE_URL = /https?:\/\/[^\s"'()\\]+?\.(?:jpg|jpeg|png|webp|avif)/gi;
const IMAGE_EXT = /\.(?:jpg|jpeg|png|webp|avif)/i;

const isMzstaticImage = (url: string): boolean =>
  url.includes("mzstatic") && IMAGE_EXT.test(url);

/**
 * Rescale the trailing `/<W>x<H><suffix>` by a factor (2 = the Retina sibling,
 * 0.5 = its 1x). Null for URLs without that shape, so non-resize URLs are left
 * alone.
 */
const scaleDims = (url: string, factor: number): string | null => {
  const m = RESIZE_PATH.exec(url);
  const width = m?.[1];
  const height = m?.[2];
  const suffix = m?.[3];
  if (m === null || width === undefined || height === undefined || suffix === undefined) {
    return null;
  }
  const w = Math.round(Number(width) * factor);
  const h = Math.round(Number(height) * factor);
  return `${url.slice(0, m.index)}/${String(w)}x${String(h)}${suffix}`;
};

export class AppleGalleryBehavior {
  static id = "site:apple.com/gallery-variants";
  static siteSpecific = true;

  static isMatch(): boolean {
    return location.hostname.endsWith("apple.com");
  }

  async *run(ctx: BehaviorCtx): AsyncGenerator<BehaviorState, BehaviorDecisions> {
    const fetched = new Set<string>();

    const fetchOnce = (url: string | null): void => {
      if (url === null || url === "" || fetched.has(url)) return;
      fetched.add(url);
      try {
        // no-cors: mzstatic is cross-origin. The CDP recorder captures the wire
        // response regardless, so the bytes still reach the WARC.
        void fetch(url, { mode: "no-cors", credentials: "include" }).catch(
          () => undefined,
        );
      } catch {
        /* ignore individual fetch failures */
      }
    };

    // 1. The document HTML as served: its markup still lists variants the
    //    hydrated DOM has dropped, which is where the missing ones come from.
    try {
      const response = await fetch(location.href, { credentials: "include" });
      const html = await response.text();
      for (const match of html.matchAll(IMAGE_URL)) {
        if (isMzstaticImage(match[0])) fetchOnce(match[0]);
      }
    } catch {
      /* fall back to the live-DOM scan below */
    }

    // 2. Belt-and-braces: for every mzstatic URL the live DOM references, also
    //    pull its 2x and 1x siblings in case the HTML pass missed one.
    const domUrls = new Set<string>();
    for (const el of Array.from(
      document.querySelectorAll("img,source,[data-src],[data-srcset],[poster]"),
    )) {
      ctx.Lib.collectCandidateUrls(el, domUrls);
    }
    for (const url of domUrls) {
      if (!isMzstaticImage(url)) continue;
      fetchOnce(url);
      fetchOnce(scaleDims(url, 2));
      fetchOnce(scaleDims(url, 0.5));
    }

    yield ctx.getState("backfill", "urls");

    return { "mzstatic urls pulled": fetched.size };
  }
}
