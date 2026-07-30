/**
 * Built-in behavior: autofetch (BROWSER side). NEW.
 *
 * Actively fetches every image URL the page *could* reference — all `srcset`
 * candidates (1x/2x, small/medium/large), `data-src` lazy attributes, and
 * same-origin stylesheet `url(...)` — even the ones the current viewport/DPR
 * did not select. The fetches flow through the same network path the
 * NetworkRecorder is watching, so those bytes land in the WARC.
 *
 * This is the fix for the "some images break on Retina replay" root cause:
 * a 1280px, DPR-1 capture only requests the `_large` (1x) candidate, so the
 * `_2x` variants a Retina replay asks for are missing. autofetch pulls them in.
 */
import type { BehaviorCtx, BehaviorDecisions } from "../types";

export class AutoFetchBehavior {
  static id = "autofetch";
  static isMatch(): boolean {
    return true;
  }

  async *run(
    ctx: BehaviorCtx,
  ): AsyncGenerator<{ msg: string; counter?: string }, BehaviorDecisions> {
    const maxUrls = Number(ctx.opts.maxUrls ?? 2000);
    const urls = new Set<string>();

    const nodes = document.querySelectorAll(
      "img,source,[data-src],[data-srcset],[data-lazy-src],[poster]",
    );
    // `currentSrc` is the one candidate the browser actually picked for this
    // element at the capture viewport and DPR. Everything else we collected is
    // a variant it would never have requested — which is precisely the gap
    // this behavior exists to close, so it is worth counting.
    const chosen = new Set<string>();
    for (const el of Array.from(nodes)) {
      ctx.Lib.collectCandidateUrls(el, urls);
      const current = (el as HTMLImageElement).currentSrc;
      if (current) chosen.add(current);
    }
    const fromElements = urls.size;
    ctx.Lib.collectStyleSheetUrls(urls);
    const fromStyleSheets = urls.size - fromElements;
    const neverRequested = [...urls].filter((u) => !chosen.has(u)).length;
    yield ctx.getState("scanned", "candidates");

    let n = 0;
    for (const url of urls) {
      if (n >= maxUrls) break;
      n++;
      // no-cors so cross-origin CDNs (e.g. mzstatic) still issue the request;
      // the CDP NetworkRecorder captures the wire response regardless of CORS.
      try {
        void fetch(url, { mode: "no-cors", credentials: "include" }).catch(
          () => undefined,
        );
      } catch {
        /* ignore individual fetch failures */
      }
      if (n % 16 === 0) {
        await ctx.Lib.sleep(0); // let the event loop breathe + yield to deadline
        yield ctx.getState("prefetch", "fetched");
      }
    }
    yield ctx.getState("prefetch-done", "fetched");

    return {
      candidates: urls.size,
      elements: nodes.length,
      "never requested by the browser": neverRequested,
      "from stylesheets": fromStyleSheets,
      fetched: n,
    };
  }
}
