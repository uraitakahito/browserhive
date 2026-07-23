/**
 * E2E global setup (runs once, only for the `e2e` Vitest project).
 *
 * It does NOT start anything — the stack is brought up out of band by
 * `container-compose --profile e2e up -d -b`. Endpoints are static by
 * design: the API is published on localhost, and meadow is reached through
 * the platform DNS name (<service>.browserhive), which resolves from both
 * the host and the Chromium workers. Override with E2E_API_URL /
 * E2E_MEADOW_URL to point elsewhere.
 *
 * container-compose provides no readiness, so this setup waits itself:
 * a bounded retry against /v1/status, then a loud failure.
 *
 * Endpoints are handed to tests via `provide` / `inject` (typed below).
 */
import type { ProvidedContext } from "vitest";

interface StackEndpoints {
  api: string;
  meadow: string;
}

// Vitest 4 exposes no named "GlobalSetupContext"; the global setup receives the
// test project, whose `provide` has this shape. Type only what we use.
interface GlobalSetupApi {
  provide: <K extends keyof ProvidedContext>(key: K, value: ProvidedContext[K]) => void;
}

/** Bounded readiness wait: attempts × 1s. */
const READY_ATTEMPTS = 45;

export default async function setup({ provide }: GlobalSetupApi): Promise<void> {
  const endpoints: StackEndpoints = {
    api: process.env["E2E_API_URL"] ?? "http://localhost:8080",
    meadow: process.env["E2E_MEADOW_URL"] ?? "http://meadow.browserhive:8080",
  };

  let reachable = false;
  for (let i = 0; i < READY_ATTEMPTS && !reachable; i++) {
    reachable = await fetch(`${endpoints.api}/v1/status`)
      .then((r) => r.ok)
      .catch(() => false);
    if (!reachable) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!reachable) {
    throw new Error(
      `E2E stack not reachable at ${endpoints.api} after ${String(READY_ATTEMPTS)}s — ` +
        "bring it up first: container-compose --profile e2e up -d -b",
    );
  }

  provide("api", endpoints.api);
  provide("meadow", endpoints.meadow);
}

declare module "vitest" {
  export interface ProvidedContext {
    api: string;
    meadow: string;
  }
}
