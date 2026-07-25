/**
 * Custom behavior for www.apple.com — drive the Apple TV+ gallery carousel.
 *
 * This file is a bare JavaScript **class expression** (not a module): the
 * example client reads it as text and the server injects it into the page as
 * `globalThis.__bh_behaviors.register(<this file>)`, then runs it through the
 * same cooperative-async-generator runner as the built-ins. It is therefore
 * excluded from tsc / ESLint (see tsconfig.*.json + eslint.config.mjs) — the
 * DOM globals (`document`, `location`, `fetch`) and `ctx` are only present at
 * injection time.
 *
 * Why it exists: autofetch scans the live DOM once, which covers *static*
 * `<picture>` variants but not a JS-driven carousel that mounts one slide at a
 * time (Apple TV+ gallery). This behavior advances the carousel and fetches
 * every candidate URL (incl. `_2x`) of each revealed slide so the Retina
 * variants land in the WACZ.
 *
 * CONVENTION: `static id` MUST equal "<dir>:<basename>" so it matches the id
 * the loader puts in the request's `behaviors.custom[].id` — the runner runs
 * an enabled id only if a registered class has the same `static id`.
 */
class {
  static id = "www.apple.com:tv-gallery";

  static isMatch() {
    return (
      location.hostname === "www.apple.com" &&
      !!document.querySelector('[aria-roledescription="carousel"],[class*="gallery"]')
    );
  }

  async *run(ctx) {
    const maxSlides = Number(ctx.opts.maxSlides ?? 20);
    const stepMs = Number(ctx.opts.stepMs ?? 800);
    const carousels = document.querySelectorAll(
      '[aria-roledescription="carousel"],[class*="gallery"]',
    );

    for (const car of Array.from(carousels)) {
      ctx.Lib.scrollIntoView(car);
      for (let i = 0; i < maxSlides; i++) {
        // Fetch every candidate URL of the currently-revealed slide(s).
        const urls = new Set();
        for (const el of Array.from(
          car.querySelectorAll("img,source,[data-src],[data-srcset],[poster]"),
        )) {
          ctx.Lib.collectCandidateUrls(el, urls);
        }
        for (const url of urls) {
          try {
            void fetch(url, { mode: "no-cors", credentials: "include" }).catch(
              () => undefined,
            );
          } catch {
            /* ignore individual fetch failures */
          }
        }
        yield ctx.getState("advanced", "slides");

        // Advance to the next slide; stop when there is no enabled "next".
        const next = car.querySelector(
          'button[aria-label*="次"],button[aria-label*="Next"],[class*="next"]',
        );
        if (
          !next ||
          next.getAttribute("aria-disabled") === "true" ||
          next.disabled === true
        ) {
          break;
        }
        next.click();
        await ctx.Lib.sleep(stepMs);
      }
    }
  }
}
