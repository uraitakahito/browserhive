/**
 * DnsRegistry — resolves worker membership from DNS at startup and on a
 * refresh interval, so workers started later (e.g. a `--profile scaleN up`)
 * are picked up without restarting browserhive, and workers that disappear
 * are retired.
 *
 * Only NXDOMAIN removes a member (see resolve-members.ts). The refresh emits
 * `onChange` only when the member set actually differs from the last one, so
 * a steady state is silent and DNS flapping does not churn the pool. Absent
 * (unprovisioned) hosts are logged only when that set changes, not on every
 * poll.
 */
import type { BrowserProfile } from "../config/index.js";
import { logger } from "../logger.js";
import { resolveMembers, type Membership } from "./resolve-members.js";
import type { WorkerRegistry } from "./worker-registry.js";

const DEFAULT_REFRESH_MS = 10_000;

/** Stable identity of a host-set, order-independent. */
const keyOf = (values: string[]): string => [...values].sort().join(",");

export class DnsRegistry implements WorkerRegistry {
  private readonly profiles: BrowserProfile[];
  private readonly refreshMs: number;
  /** Last-logged absent set, so unprovisioned hosts are reported only on change. */
  private lastAbsentKey = "";

  constructor(profiles: BrowserProfile[], refreshMs: number = DEFAULT_REFRESH_MS) {
    this.profiles = profiles;
    this.refreshMs = refreshMs;
  }

  /** Resolve membership, logging the absent set only when it changes. */
  private async resolve(): Promise<Membership> {
    const membership = await resolveMembers(this.profiles);
    const absentKey = keyOf(membership.absent);
    if (absentKey !== this.lastAbsentKey) {
      this.lastAbsentKey = absentKey;
      if (membership.absent.length > 0) {
        logger.info(
          { absent: membership.absent },
          "workers not provisioned (NXDOMAIN) — excluded from the pool",
        );
      }
    }
    return membership;
  }

  async list(): Promise<BrowserProfile[]> {
    return (await this.resolve()).present;
  }

  subscribe(onChange: (members: BrowserProfile[]) => void): () => void {
    let lastPresentKey = "";
    void this.list().then((present) => {
      lastPresentKey = keyOf(present.map((p) => p.browserURL.href));
    });

    const tick = async (): Promise<void> => {
      try {
        const present = (await this.resolve()).present;
        const key = keyOf(present.map((p) => p.browserURL.href));
        if (key !== lastPresentKey) {
          lastPresentKey = key;
          logger.info(
            { members: present.map((p) => p.browserURL.host) },
            "worker membership changed",
          );
          onChange(present);
        }
      } catch (e) {
        // resolveMembers throws only when *every* host is NXDOMAIN. Keep the
        // last known membership rather than tearing the pool down to zero.
        logger.warn(
          { err: e },
          "membership refresh found no workers — keeping current set",
        );
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
