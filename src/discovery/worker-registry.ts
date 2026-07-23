/**
 * WorkerRegistry — the membership *source*, decoupled from the coordinator.
 *
 * The coordinator asks a registry "who are the members?" and subscribes for
 * changes; it never treats the raw config list as ground truth. This is the
 * same separation gRPC (name resolver) and Envoy (EDS) draw between
 * membership (discovery) and health (monitoring).
 *
 * Implementations:
 *   - StaticRegistry — no discovery; returns the configured profiles as-is
 *     and never emits a change. The baseline (== the pre-registry behaviour).
 *   - DnsRegistry (dns-registry.ts) — resolves membership from DNS at start
 *     and on a refresh interval, emitting add/remove as workers come and go.
 */
import type { BrowserProfile } from "../config/index.js";

export interface WorkerRegistry {
  /** The current membership. */
  list(): Promise<BrowserProfile[]>;
  /**
   * Observe membership changes. `onChange` receives the full new member set
   * (not a delta). Returns an unsubscribe function. A static source may never
   * call `onChange`.
   */
  subscribe(onChange: (members: BrowserProfile[]) => void): () => void;
}

/**
 * Non-discovering registry: the configured profiles are the membership,
 * forever. Used as the explicit baseline and in tests.
 */
export class StaticRegistry implements WorkerRegistry {
  private readonly profiles: BrowserProfile[];

  constructor(profiles: BrowserProfile[]) {
    this.profiles = profiles;
  }

  list(): Promise<BrowserProfile[]> {
    return Promise.resolve(this.profiles);
  }

  subscribe(): () => void {
    // Membership is fixed — nothing to observe.
    return () => {
      // noop
    };
  }
}
