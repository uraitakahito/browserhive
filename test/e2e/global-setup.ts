/**
 * E2E global setup (runs once, only for the `e2e` Vitest project).
 *
 * It does NOT start anything — the stack is brought up out of band by
 * `./bin/stack.sh up`, which writes `.e2e-stack.json`. This setup reads that file
 * and probes the running server. If the stack is not reachable it throws,
 * so a forgotten `bin/stack.sh up` fails loudly instead of silently skipping.
 *
 * Endpoints are handed to tests via `provide` / `inject` (typed below),
 * never through environment variables.
 */
import { readFileSync } from "node:fs";

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

export default async function setup({ provide }: GlobalSetupApi): Promise<void> {
  let endpoints: StackEndpoints;
  try {
    endpoints = JSON.parse(readFileSync(".e2e-stack.json", "utf8")) as StackEndpoints;
  } catch {
    throw new Error(".e2e-stack.json not found — bring the stack up first: ./bin/stack.sh up");
  }

  const reachable = await fetch(`${endpoints.api}/v1/status`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    throw new Error(`E2E stack not reachable at ${endpoints.api}. Run ./bin/stack.sh up first.`);
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
