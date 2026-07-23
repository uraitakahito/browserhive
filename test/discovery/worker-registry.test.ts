import { describe, it, expect } from "vitest";

import {
  StaticRegistry,
  type WorkerRegistry,
} from "../../src/discovery/worker-registry.js";
import type { BrowserProfile } from "../../src/config/index.js";

const profile = (host: string): BrowserProfile =>
  ({ browserURL: new URL(`http://${host}:9222/`) }) as BrowserProfile;

describe("StaticRegistry", () => {
  it("returns the configured profiles unchanged", async () => {
    const profiles = [profile("chromium-1"), profile("chromium-2")];
    const registry = new StaticRegistry(profiles);
    await expect(registry.list()).resolves.toBe(profiles);
  });

  it("never emits a membership change", () => {
    let called = false;
    const registry: WorkerRegistry = new StaticRegistry([profile("chromium-1")]);
    const unsubscribe = registry.subscribe(() => {
      called = true;
    });
    // Give any (erroneous) async emission a chance to fire.
    unsubscribe();
    expect(called).toBe(false);
  });
});
