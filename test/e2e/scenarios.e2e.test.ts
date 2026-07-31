/**
 * Scenario E2E: drive meadow's fixture scenarios through the real stack and
 * prove browser behaviour from the outside via meadow's request counters.
 */
import { describe, it, expect, beforeEach, inject } from "vitest";
import { scenarios } from "meadow";

import { submitAndWait, captureRequest, resetMeadow, meadowRequestCounts } from "./helpers/capture.js";

const api = inject("api");
const meadow = inject("meadow");

describe("meadow scenarios through browserhive + chromium-server-docker", () => {
  beforeEach(async () => {
    await resetMeadow(meadow);
  });

  it("failsThenSucceeds(2): browserhive retries via real Chrome and succeeds on the 3rd hit", async ({ annotate }) => {
    // maxRetryCount=2 → attempts 1,2 get 503 (retry), attempt 3 gets 200.
    const path = scenarios.failsThenSucceeds(2, "e2e");
    await submitAndWait(api, captureRequest(meadow + path), annotate);
    const hits = await meadowRequestCounts(meadow);
    expect(hits[path]).toBe(3);
  });

  it("client-side redirect: location.replace is followed to the redirect target", async ({ annotate }) => {
    await submitAndWait(api, captureRequest(meadow + scenarios.clientSideRedirect), annotate);
    const hits = await meadowRequestCounts(meadow);
    // Through the contract rather than as a literal: meadow owns these paths,
    // and a rename there should break the build here, not a run months later.
    expect(hits[scenarios.redirectTarget]).toBeGreaterThanOrEqual(1);
  });

  it("lazy images: autoScroll pulls the below-the-fold image", async ({ annotate }) => {
    await submitAndWait(api, captureRequest(meadow + scenarios.lazyImages), annotate);
    const hits = await meadowRequestCounts(meadow);
    expect(hits[scenarios.asset("below.svg")]).toBeGreaterThanOrEqual(1);
  });
});
