/**
 * Smoke E2E: prove the whole real stack captures a page end-to-end
 * (browserhive → chromium-server-docker → meadow), observed black-box.
 */
import { describe, it, expect, inject } from "vitest";
import { scenarios } from "meadow";

import { submitAndWait, captureRequest, resetMeadow, meadowRequestCounts } from "./helpers/capture.js";

const api = inject("api");
const meadow = inject("meadow");

describe("browserhive + chromium-server-docker + meadow", () => {
  it("captures /plain-html end-to-end through the real stack", async ({ annotate }) => {
    await resetMeadow(meadow);
    await submitAndWait(api, captureRequest(meadow + scenarios.plainHtml), annotate);
    const hits = await meadowRequestCounts(meadow);
    expect(hits[scenarios.plainHtml]).toBeGreaterThanOrEqual(1);
  });
});
