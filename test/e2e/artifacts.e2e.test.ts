/**
 * Artefact E2E: prove that what the API says it stored is really in the object
 * store, and is really a WACZ.
 *
 * Every other test in this suite stops at the API's own verdict plus meadow's
 * hit counters, so the upload itself has never been checked by anything: a PUT
 * that failed, a key built wrong, a bucket that does not exist would all leave
 * the whole suite green. This is the test that closes that gap, and it is worth
 * having even though it asserts something that "obviously" works.
 */
import { describe, expect, inject, it } from "vitest";
import { scenarios } from "meadow";

import { captureRequest, submitAndWait, WACZ_ONLY } from "./helpers/capture.js";
import { datapackage, fetchArtifact, makeS3, openWacz } from "./helpers/artifact.js";

const api = inject("api");
const meadow = inject("meadow");
const s3 = makeS3(inject("s3"));

/**
 * Spelled out rather than shared with the unit test that asserts the same
 * names. The unit test states what the packager writes; this states what a
 * caller ends up holding. They agree today, and if they ever stop agreeing
 * that is the finding — not something one of them should quietly inherit.
 */
const WACZ_ENTRIES = [
  "archive/data.warc.gz",
  "datapackage.json",
  "fuzzy.json",
  "indexes/index.cdxj",
  "pages/pages.jsonl",
];

describe("capture artefacts land in the object store", () => {
  it("the WACZ the API reported is present, is a zip, and holds the WACZ layout", async ({
    annotate,
  }) => {
    const url = meadow + scenarios.plainHtml;
    const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);

    expect(report.status).toBe("success");
    expect(report.artifacts.wacz).toMatch(/^s3:\/\//);

    const bytes = await fetchArtifact(s3, report.artifacts.wacz!);
    await annotate(`${report.artifacts.wacz!} → ${String(bytes.length)} bytes`, "artifacts");

    // Cheapest possible proof that bytes survived the round trip intact: a zip
    // starts "PK". Checked before unzipping so a truncated or empty object
    // fails here, with its length in the annotation, rather than inside fflate.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");

    const entries = openWacz(bytes);
    expect(Object.keys(entries).sort()).toEqual(WACZ_ENTRIES);

    // That this is OUR capture, not a leftover from an earlier run that happened
    // to be sitting at a similar key.
    expect(datapackage(entries)["mainPageURL"]).toBe(url);
  });

  it("carries its own account of what it could not get", async ({ annotate }) => {
    // Unit tests prove the packager writes the key when handed one. Only this
    // proves a real capture hands it one — the report is assembled in
    // page-capturer from a behavior's return value and the recorder's
    // responses, and either could stop arriving without a unit test noticing.
    //
    // Read from the archive rather than the API response on purpose: the
    // archive is what travels, and the whole point of writing it here is that
    // someone who never saw the response can still ask.
    const url = `${meadow}${scenarios.plainHtml}`;
    const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);
    expect(report.status).toBe("success");

    const entries = openWacz(await fetchArtifact(s3, report.artifacts.wacz!));
    const capture = datapackage(entries)["browserhive:capture"] as {
      completeness?: { complete?: boolean };
      coverage?: { scrollExhausted?: boolean; scrollSteps?: number };
    };
    await annotate(JSON.stringify(capture), "capture-report");

    expect(capture.completeness?.complete).toBe(true);
    // A short static page: autoscroll runs out of page, not out of steps.
    expect(capture.coverage?.scrollExhausted).toBe(false);
    expect(capture.coverage?.scrollSteps).toBeLessThan(40);
  });

  it("records the settings that applied, not the ones that were asked for", async ({
    annotate,
  }) => {
    // The request below sets neither `cache` nor `archiveMode`, so `task.cache`
    // and `task.archiveMode` are both undefined. Every one of these resolves as
    // `task.X ?? config.X`, and writing the request instead of the resolution
    // would leave the archive unable to say whether it was captured with the
    // cache cleared — which is the difference between an archive with bodies
    // and one full of 304s.
    const url = `${meadow}${scenarios.plainHtml}`;
    const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);
    expect(report.status).toBe("success");

    const entries = openWacz(await fetchArtifact(s3, report.artifacts.wacz!));
    const capture = datapackage(entries)["browserhive:capture"] as {
      build?: { version?: string; revision?: string };
      browser?: { product?: string };
      settings?: {
        cache?: string;
        archiveMode?: string;
        devicePixelRatios?: number[];
        behaviors?: string[];
        viewport?: { width?: number };
      };
    };
    await annotate(JSON.stringify(capture), "environment");

    expect(capture.settings?.cache).toBe("clear");
    expect(capture.settings?.archiveMode).toBe("single-pass");
    // A single pass is still a list. `multipass` sweeps two, and a lone number
    // would tell a reader the 2x variants are absent when they are present.
    expect(capture.settings?.devicePixelRatios).toEqual([1]);
    expect(capture.settings?.viewport?.width).toBe(1280);
    // Taken from what ran, not from configuration — site behaviors never
    // appear in `enabled`, so copying the config would miss them.
    expect(capture.settings?.behaviors).toContain("autoscroll");

    expect(capture.build?.revision).toMatch(/^[0-9a-f]{7,}$/);
    expect(capture.browser?.product).toMatch(/^Chrome\//);
  });

  it("records both passes when multipass ran", async ({ annotate }) => {
    const url = `${meadow}${scenarios.plainHtml}`;
    const report = await submitAndWait(
      api,
      captureRequest(url, { formats: WACZ_ONLY, archiveMode: "multipass" }),
      annotate,
    );

    const entries = openWacz(await fetchArtifact(s3, report.artifacts.wacz!));
    const settings = (
      datapackage(entries)["browserhive:capture"] as {
        settings?: { devicePixelRatios?: number[] };
      }
    ).settings;

    expect(settings?.devicePixelRatios).toEqual([1, 2]);
  });

  it("says so when scrolling stopped at the cap rather than the page end", async ({
    annotate,
  }) => {
    // The case the coverage report exists for. Until meadow grew a page with
    // no bottom this was checked by hand against www.yahoo.co.jp — network
    // required, a different answer every run, and nothing left behind in any
    // repository.
    const url = `${meadow}${scenarios.endlessFeed}`;
    const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);

    // Giving up is not failing. What was captured was captured correctly.
    expect(report.status).toBe("success");

    const entries = openWacz(await fetchArtifact(s3, report.artifacts.wacz!));
    const capture = datapackage(entries)["browserhive:capture"] as {
      completeness?: { complete?: boolean };
      coverage?: { scrollExhausted?: boolean; scrollSteps?: number; scrolledPx?: number };
    };
    await annotate(JSON.stringify(capture), "capture-report");

    expect(capture.coverage?.scrollExhausted).toBe(true);
    // Written out rather than read from config on purpose. Raising the cap is
    // a decision about how much of a page to archive, and a test that follows
    // it silently is not guarding anything.
    expect(capture.coverage?.scrollSteps).toBe(40);
    expect(capture.coverage?.scrolledPx).toBe(32_000);

    // The distinction the two reports exist to keep apart: not having looked
    // below the cut-off is not the same as holding a broken body.
    expect(capture.completeness?.complete).toBe(true);
  });
});
