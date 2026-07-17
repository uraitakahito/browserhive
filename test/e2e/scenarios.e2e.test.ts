/**
 * Scenario E2E: drive meadow's fixture scenarios through the real stack and
 * prove browser behaviour from the outside via meadow's /__hits counters.
 */
import { describe, it, expect, beforeEach, inject } from "vitest";
import { scenarios } from "meadow";

import { submitAndWait, captureRequest, resetMeadow, meadowHits } from "./helpers/capture.js";

const api = inject("api");
const meadow = inject("meadow");

describe("meadow scenarios through browserhive + chromium-server-docker", () => {
  beforeEach(async () => {
    await resetMeadow(meadow);
  });

  it("flaky(2): browserhive retries via real Chrome and succeeds on the 3rd hit", async () => {
    // maxRetryCount=2 → attempts 1,2 get 503 (retry), attempt 3 gets 200.
    const path = scenarios.flaky(2, "e2e");
    await submitAndWait(api, captureRequest(meadow + path));
    const hits = await meadowHits(meadow);
    expect(hits[path]).toBe(3);
  });

  it("redirect-page: client-side location.replace is followed to /landed", async () => {
    await submitAndWait(api, captureRequest(meadow + scenarios.redirectPage));
    const hits = await meadowHits(meadow);
    expect(hits["/landed"]).toBeGreaterThanOrEqual(1);
  });

  it("lazy: autoScroll pulls the below-the-fold image", async () => {
    await submitAndWait(api, captureRequest(meadow + scenarios.lazy));
    const hits = await meadowHits(meadow);
    expect(hits["/assets/below.svg"]).toBeGreaterThanOrEqual(1);
  });
});
