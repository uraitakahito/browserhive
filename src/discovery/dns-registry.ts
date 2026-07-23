/**
 * DnsRegistry — resolves worker membership from DNS at startup and on a
 * refresh interval, so workers started later (e.g. a `--profile scaleN up`)
 * are picked up without restarting browserhive, and workers that disappear
 * are retired.
 *
 * Only NXDOMAIN removes a member (see resolve-members.ts). The refresh emits
 * `onChange` only when the member set actually differs from the last one, so
 * a steady state is silent and DNS flapping does not churn the pool.
 */
import type { BrowserProfile } from "../config/index.js";
import { logger } from "../logger.js";
import { resolveMembers } from "./resolve-members.js";
import type { WorkerRegistry } from "./worker-registry.js";

const DEFAULT_REFRESH_MS = 10_000;

/** Stable identity of a member set, order-independent. */
const membershipKey = (profiles: BrowserProfile[]): string =>
  profiles
    .map((p) => p.browserURL.href)
    .sort()
    .join(",");

export class DnsRegistry implements WorkerRegistry {
  private readonly profiles: BrowserProfile[];
  private readonly refreshMs: number;

  constructor(profiles: BrowserProfile[], refreshMs: number = DEFAULT_REFRESH_MS) {
    this.profiles = profiles;
    this.refreshMs = refreshMs;
  }

  async list(): Promise<BrowserProfile[]> {
    return (await resolveMembers(this.profiles)).present;
  }

  subscribe(onChange: (members: BrowserProfile[]) => void): () => void {
    // Seed from the current membership so the first *change* is a real change.
    let lastKey = "";
    void this.list().then((present) => {
      lastKey = membershipKey(present);
    });

    const tick = async (): Promise<void> => {
      try {
        const present = (await resolveMembers(this.profiles)).present;
        const key = membershipKey(present);
        if (key !== lastKey) {
          lastKey = key;
          logger.info(
            { members: present.map((p) => p.browserURL.host) },
            "worker membership changed",
          );
          onChange(present);
        }
      } catch (e) {
        // resolveMembers throws only when *every* host is NXDOMAIN. Keep the
        // last known membership rather than tearing the pool down to zero.
        logger.warn({ err: e }, "membership refresh found no workers — keeping current set");
      }
    };

    const timer = setInterval(() => void tick(), this.refreshMs);
    // Do not keep the event loop alive solely for the refresh timer.
    timer.unref();
    return () => {
      clearInterval(timer);
    };
  }
}
