/**
 * The HTTP cache, and the one thing unit tests cannot say about it.
 *
 * Unit tests pin down which CDP commands each mode issues. They cannot pin down
 * what those commands *do*, and that turned out to matter more than expected:
 * the design assumed a capture with the cache disabled would leave nothing
 * stored, so that `clear` would keep later captures fresh while `bypass` would
 * not. Written as a test, that assumption failed. Chromium stops the capture
 * *reading* the cache and stores the response anyway, so both modes leave the
 * URL they visited cached, and a following `default` capture of it gets a 304.
 *
 * Which is why every case here submits more than one capture. A single capture
 * proves nothing that `test/capture/page-capturer-wacz.test.ts` has not already
 * proved more cheaply — and would have let the wrong model stand.
 *
 * These need `meadow.cacheable` — the only fixture route that revalidates.
 * Every other route sends no `ETag` and no `Last-Modified`, so Chromium never
 * asks and a `304` can never happen.
 */
import { describe, expect, inject, it } from "vitest";
import { scenarios } from "meadow";

import { captureRequest, submitAndWait, WACZ_ONLY } from "./helpers/capture.js";

const api = inject("api");
const meadow = inject("meadow");

/** A fresh URL per test, so one test's cache state cannot decide another's. */
const cacheableUrl = (tag: string): string =>
  `${meadow}${scenarios.cacheable}?case=${tag}`;

describe("a URL captured twice with the cache in play", () => {
  it("comes back 304 the second time, which is what all of this is about", async ({
    annotate,
  }) => {
    const url = cacheableUrl("baseline");

    const first = await submitAndWait(
      api,
      captureRequest(url, { formats: WACZ_ONLY, cache: "default" }),
      annotate,
    );
    expect(first.status).toBe("success");

    // The failure the cache modes exist for. `304` carries no body, so there
    // is nothing to archive — the capture fails even though the page is fine
    // and the browser renders it perfectly from cache.
    const second = await submitAndWait(
      api,
      captureRequest(url, { formats: WACZ_ONLY, cache: "default" }),
      annotate,
    );
    expect(second.status).toBe("httpError");
    expect(second.httpStatusCode).toBe(304);
  });
});

describe("a capture that does not read the cache still fills it", () => {
  it("populates the entry anyway, for both bypass and clear", async ({ annotate }) => {
    // Measured, and it contradicts the obvious reading of "cache disabled".
    // Chromium's setCacheDisabled stops the capture *reading* the cache; the
    // response it fetched still ends up stored. So neither `bypass` nor
    // `clear` leaves the URL it just visited absent from the cache, and a
    // following `default` capture of that URL revalidates and gets a 304.
    //
    // This is what separates the two modes from what one might assume they do,
    // and it is why the shipped default is `clear` on *every* capture rather
    // than a one-off reset.
    for (const cache of ["bypass", "clear"] as const) {
      const url = cacheableUrl(`fills-${cache}`);

      const first = await submitAndWait(
        api,
        captureRequest(url, { formats: WACZ_ONLY, cache }),
        annotate,
      );
      expect(first.status).toBe("success");
      expect(first.httpStatusCode).toBe(200);

      const next = await submitAndWait(
        api,
        captureRequest(url, { formats: WACZ_ONLY, cache: "default" }),
        annotate,
      );
      await annotate(`${cache} → default: ${next.status}`, "cache");
      expect(next.status).toBe("httpError");
      expect(next.httpStatusCode).toBe(304);
    }
  });
});

describe("clear", () => {
  it("removes entries left by earlier captures of other URLs", async ({ annotate }) => {
    // What `clear` actually buys, once the assumption above is corrected: it
    // empties the whole cache, so nothing any earlier capture stored can
    // influence this one. `bypass` leaves all of it in place.
    const stale = cacheableUrl("clear-stale");
    const fresh = cacheableUrl("clear-fresh");

    // Leave an entry behind for `stale`.
    await submitAndWait(api, captureRequest(stale, { formats: WACZ_ONLY, cache: "default" }), annotate);

    // Capturing something else with `clear` empties the cache, `stale`
    // included.
    await submitAndWait(api, captureRequest(fresh, { formats: WACZ_ONLY, cache: "clear" }), annotate);

    // `stale` is therefore fetched afresh rather than revalidated.
    const after = await submitAndWait(
      api,
      captureRequest(stale, { formats: WACZ_ONLY, cache: "default" }),
      annotate,
    );
    expect(after.status).toBe("success");
    expect(after.httpStatusCode).toBe(200);
  });
});

describe("the shipped default", () => {
  it("captures the same URL repeatedly without ever seeing a 304", async ({ annotate }) => {
    // No `cache` field at all — this is what a caller gets by default, and the
    // reason the default is `clear`: an archiver whose archives are empty
    // because the browser had seen the page before is not much of an archiver.
    const url = cacheableUrl("default-mode");

    for (const attempt of [1, 2, 3]) {
      const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);
      await annotate(`attempt ${String(attempt)}: ${report.status}`, "cache");
      expect(report.status).toBe("success");
      expect(report.httpStatusCode).toBe(200);
    }
  });
});
