import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:dns/promises before importing the module under test.
const lookup =
  vi.fn<(hostname: string) => Promise<{ address: string; family: number }>>();
vi.mock("node:dns/promises", () => ({ lookup: (h: string) => lookup(h) }));

import { DnsRegistry } from "../../src/discovery/dns-registry.js";
import type { BrowserProfile } from "../../src/config/index.js";

const profile = (host: string): BrowserProfile =>
  ({ browserURL: new URL(`http://${host}:9222/`) }) as BrowserProfile;

const resolves = (): Promise<{ address: string; family: number }> =>
  Promise.resolve({ address: "10.0.0.1", family: 4 });
const nxdomain = (): Promise<never> =>
  Promise.reject(
    Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
  );

describe("DnsRegistry", () => {
  beforeEach(() => {
    lookup.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a membership change on the configured refresh interval", async () => {
    // Initially only chromium-1 is provisioned.
    lookup.mockImplementation((host) =>
      host === "chromium-1" ? resolves() : nxdomain(),
    );
    const profiles = [profile("chromium-1"), profile("chromium-2")];
    const registry = new DnsRegistry(profiles, 5000);

    const changes: string[][] = [];
    const unsubscribe = registry.subscribe((members) =>
      changes.push(members.map((p) => p.browserURL.hostname)),
    );

    // Let the seed list() settle; no change emitted yet.
    await vi.advanceTimersByTimeAsync(0);
    expect(changes).toHaveLength(0);

    // chromium-2 comes up.
    lookup.mockImplementation(resolves);

    // Before one interval elapses: still no emission.
    await vi.advanceTimersByTimeAsync(4000);
    expect(changes).toHaveLength(0);

    // Crossing the 5000ms interval triggers exactly one change with both.
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes).toEqual([["chromium-1", "chromium-2"]]);

    unsubscribe();
  });

  it("stops polling after unsubscribe", async () => {
    lookup.mockImplementation(resolves);
    const registry = new DnsRegistry([profile("chromium-1")], 5000);
    const changes: string[][] = [];
    const unsubscribe = registry.subscribe((m) =>
      changes.push(m.map((p) => p.browserURL.hostname)),
    );
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(changes).toHaveLength(0);
  });
});
