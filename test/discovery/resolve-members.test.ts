import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:dns/promises before importing the module under test.
const lookup = vi.fn<(hostname: string) => Promise<{ address: string; family: number }>>();
vi.mock("node:dns/promises", () => ({ lookup: (h: string) => lookup(h) }));

import { resolveMembers } from "../../src/discovery/resolve-members.js";
import type { BrowserProfile } from "../../src/config/index.js";

const profile = (host: string): BrowserProfile =>
  ({ browserURL: new URL(`http://${host}:9222/`) }) as BrowserProfile;

const nxdomain = (): NodeJS.ErrnoException =>
  Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
const transient = (): NodeJS.ErrnoException =>
  Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" });

describe("resolveMembers", () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it("keeps hosts that resolve and drops NXDOMAIN ones", async () => {
    lookup.mockImplementation((host: string) =>
      host === "chromium-1" ? Promise.resolve({ address: "10.0.0.1", family: 4 }) : Promise.reject(nxdomain()),
    );

    const { present, absent } = await resolveMembers([
      profile("chromium-1"),
      profile("chromium-2"),
      profile("chromium-3"),
    ]);

    expect(present.map((p) => p.browserURL.hostname)).toEqual(["chromium-1"]);
    expect(absent).toEqual(["chromium-2", "chromium-3"]);
  });

  it("keeps a host on a transient (non-NXDOMAIN) failure — that is a health concern", async () => {
    lookup.mockRejectedValue(transient());

    const { present, absent } = await resolveMembers([profile("chromium-1")]);

    expect(present.map((p) => p.browserURL.hostname)).toEqual(["chromium-1"]);
    expect(absent).toEqual([]);
  });

  it("throws only when every host is NXDOMAIN", async () => {
    lookup.mockRejectedValue(nxdomain());

    await expect(resolveMembers([profile("chromium-1")])).rejects.toThrow(
      /no provisioned workers/,
    );
  });
});
