/**
 * Membership resolution — the "which workers actually exist" step, kept
 * separate from health ("which are usable right now").
 *
 * A declared worker whose hostname does not resolve (NXDOMAIN / ENOTFOUND)
 * is not provisioned — under the compose stack it simply was not started by
 * the active scale profile — so it is dropped from the pool instead of being
 * carried as a permanently-failing worker. Every other outcome keeps the
 * worker: a transient DNS failure (EAI_AGAIN) or a resolvable host whose CDP
 * is not up yet (later ECONNREFUSED) is a *health* concern, handled by the
 * coordinator's degraded/retry machinery.
 *
 * The same `dns.lookup` primitive is what `browser.ts:resolveWsUrlHost` uses
 * on the connect path, so membership and connection agree on resolution.
 */
import { lookup } from "node:dns/promises";

import type { BrowserProfile } from "../config/index.js";

export interface Membership {
  /** Profiles whose host resolves (or failed only transiently) — kept in the pool. */
  present: BrowserProfile[];
  /** Hostnames dropped because they do not exist (NXDOMAIN). */
  absent: string[];
}

/** True only for a definitive "this name does not exist" DNS error. */
const isNxdomain = (e: unknown): boolean =>
  (e as NodeJS.ErrnoException | undefined)?.code === "ENOTFOUND";

/**
 * Resolve the declared profiles against DNS once and split them into
 * present (provisioned) vs absent (NXDOMAIN). Pure — never logs; callers
 * decide when a change is worth reporting. Never throws for individual
 * lookups; throws only if the resulting present set is empty, since a
 * coordinator with zero workers cannot serve.
 */
export const resolveMembers = async (
  profiles: BrowserProfile[],
): Promise<Membership> => {
  const checks = await Promise.all(
    profiles.map(async (profile) => {
      try {
        await lookup(profile.browserURL.hostname);
        return { profile, present: true };
      } catch (e) {
        // NXDOMAIN → not provisioned. Any other failure is inconclusive,
        // so keep the worker and let the health layer decide.
        return { profile, present: !isNxdomain(e) };
      }
    }),
  );

  const present = checks.filter((c) => c.present).map((c) => c.profile);
  const absent = checks
    .filter((c) => !c.present)
    .map((c) => c.profile.browserURL.hostname);

  if (present.length === 0) {
    throw new Error(
      "no provisioned workers: every declared BROWSERHIVE_BROWSER_URLS host is NXDOMAIN",
    );
  }
  return { present, absent };
};
