/**
 * Custom behavior for www.apple.com — make the Apple TV+ gallery replay
 * faithfully at BOTH normal (DPR 1) and Retina (DPR 2) resolutions by ensuring
 * every declared image variant of each slide is archived.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FILE FORMAT
 * ─────────────────────────────────────────────────────────────────────────
 * This file is a bare JavaScript **class expression** (no name, no `export`).
 * The example client reads it as text and the server injects it into the page
 * as `globalThis.__bh_behaviors.register(<this file>)`, then runs it through
 * the same cooperative-async-generator runner as the built-ins. It runs in the
 * *browser*, not Node, and is excluded from tsc / ESLint (see tsconfig.*.json +
 * eslint.config.mjs): `document`, `location`, `fetch` and `ctx` only exist at
 * injection time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE PROBLEM (verified against the live capture browser via DevTools)
 * ─────────────────────────────────────────────────────────────────────────
 * apple.com/jp serves the TV+ slides as mzstatic resize URLs of the shape
 *
 *     https://is1-ssl.mzstatic.com/image/thumb/<token>/<W>x<H>sr.jpg
 *
 * The initial HTML declares several `<W>x<H>` candidates per slide (e.g.
 * `980x522` as 1x and `1960x1044` as 2x). But apple's JavaScript hydrates the
 * carousel and resolves each slide to the *single* variant matching the capture
 * viewport's DPR, discarding the rest from what the built-in autofetch can see:
 *
 *     capture at DPR 1  →  browser loads only …/980x522sr.jpg  (1x)
 *     capture at DPR 2  →  browser loads only …/1960x1044sr.jpg (2x)
 *
 * So whichever DPR we capture at, the *other* variant is missing from the WACZ,
 * and a replay at the opposite DPR shows a black slide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FIX (capture at DPR 2, then archive the declared variants from the HTML)
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Capture at **DPR 2** (`--device-scale-factor 2` on the client, or
 *    `BROWSERHIVE_DEVICE_SCALE_FACTOR=2` on the server). The browser itself then
 *    loads each slide's 2x during the normal page load — the only reliable way
 *    to obtain a variant apple's JS actually renders.
 * 2. This behavior additionally makes a BEST-EFFORT attempt to also archive the
 *    complementary 1x (for the less-common case of replaying at DPR 1): it
 *    re-fetches the document HTML with `fetch(location.href)` and pulls mzstatic
 *    image URLs out of it, and scans the live DOM's `<img>`/`<source>`
 *    candidates and fetches each mzstatic resize URL's doubled and halved
 *    siblings. It is restricted to mzstatic (apple's image CDN) so it stays a
 *    bounded back-fill rather than a fetch-the-world pass.
 *
 * IMPORTANT — what actually fixes the reported bug is step 1 (the DPR-2
 * capture). Step 2 is best-effort and, for this carousel, does NOT reliably
 * capture the 1x. That is a hard-won empirical fact, recorded here so nobody
 * re-treads it:
 *
 *   VERIFIED (2026-07-26, apple.com/jp captured at DPR 2): the WACZ contained
 *   9 × `1960x1044` (the 2x) but **0 × `980x522` (the 1x)**. EVERY approach to
 *   also grab the 1x left it at 0, exactly like the built-in autofetch:
 *     (a) `fetch(location.href)` and extract mzstatic URLs from the SSR HTML,
 *     (b) scanning the live `<img>` / `<source>` candidates, and
 *     (c) deriving the ÷2 sibling from the resolved 2x URL.
 *   Why: apple renders exactly ONE variant per DPR and hydrates the carousel
 *   aggressively, so by the time behaviors run the slide's other variants are no
 *   longer reachable from the live DOM, and the document HTML re-fetched inside
 *   the capture context does not surface the 1x URLs either. Note too that at
 *   DPR 2 the built-ins (autoscroll + autofetch) already archive the 2x on their
 *   own — this behavior is not what obtains it.
 *
 *   Capturing BOTH variants deterministically would require rendering the page
 *   twice, once per DPR (out of scope here). If you need the 1x as well, capture
 *   the URL a second time at DPR 1.
 *
 * CONVENTION: `static id` MUST equal "<dir>:<basename>" so it matches the id
 * the loader puts in the request's `behaviors.custom[].id` (the runner matches
 * enabled ids to registered classes by `static id`).
 */
class {
  static id = "www.apple.com:tv-gallery";

  static isMatch() {
    return location.hostname === "www.apple.com";
  }

  async *run(ctx) {
    const fetched = new Set();

    const fetchOnce = (url) => {
      if (!url || fetched.has(url)) return;
      fetched.add(url);
      try {
        // no-cors: mzstatic is cross-origin. The CDP NetworkRecorder still
        // captures the wire response, so the bytes land in the WACZ.
        void fetch(url, { mode: "no-cors", credentials: "include" }).catch(
          () => undefined,
        );
      } catch {
        /* ignore individual fetch failures */
      }
    };

    // Rescale the trailing `/<W>x<H><suffix>` of an mzstatic resize URL by a
    // factor (x2 = Retina sibling, x0.5 = its 1x). Null for other URL shapes.
    const scaleDims = (url, factor) => {
      const m = /\/(\d{2,4})x(\d{2,4})([^/]*)$/.exec(url);
      if (!m) return null;
      const w = Math.round(Number(m[1]) * factor);
      const h = Math.round(Number(m[2]) * factor);
      return url.slice(0, m.index) + "/" + String(w) + "x" + String(h) + m[3];
    };

    const isMzstaticImage = (u) =>
      u.includes("mzstatic") && /\.(?:jpg|jpeg|png|webp|avif)/i.test(u);

    // 1. Re-fetch the document HTML. Its SSR markup still lists every declared
    //    variant (the 1x AND the 2x), which the hydrated live DOM has collapsed
    //    away — this is where the missing slide variants come from.
    try {
      const html = await (
        await fetch(location.href, { credentials: "include" })
      ).text();
      for (const m of html.matchAll(
        /https?:\/\/[^\s"'()\\]+?\.(?:jpg|jpeg|png|webp|avif)/gi,
      )) {
        if (isMzstaticImage(m[0])) fetchOnce(m[0]);
      }
    } catch {
      /* fall back to the live-DOM scan below */
    }

    // 2. Belt-and-braces: scan the live DOM candidates and, for each mzstatic
    //    resize URL, also fetch its 2x and 1x siblings so both are present even
    //    if the HTML pass missed something.
    const domUrls = new Set();
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
  }
}
