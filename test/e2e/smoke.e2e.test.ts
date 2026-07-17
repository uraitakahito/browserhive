/**
 * Smoke E2E: prove the whole real stack captures a page end-to-end
 * (browserhive → chromium-server-docker → meadow), observed black-box.
 */
import { describe, it, expect, inject } from "vitest";
import { scenarios } from "meadow";

import { submitAndWait, captureRequest, resetMeadow, meadowHits } from "./helpers/capture.js";

const api = inject("api");
const meadow = inject("meadow");

describe("browserhive + chromium-server-docker + meadow", () => {
  it("captures /ok end-to-end through the real stack", async () => {
    await resetMeadow(meadow);
    await submitAndWait(api, captureRequest(meadow + scenarios.ok));
    const hits = await meadowHits(meadow);
    expect(hits[scenarios.ok]).toBeGreaterThanOrEqual(1);
  });
});
