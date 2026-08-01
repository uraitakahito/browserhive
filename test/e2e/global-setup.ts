/**
 * E2E global setup (runs once, only for the `e2e` Vitest project).
 *
 * It does NOT start anything — the stack is brought up out of band by
 * `container-compose --profile meadow up -d -b`. Endpoints are static by
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
import { execFileSync } from "node:child_process";

import type { ProvidedContext } from "vitest";

interface StackEndpoints {
  api: string;
  meadow: string;
  /**
   * SeaweedFS S3 as seen FROM THE HOST — not the `seaweedfs.browserhive:8333`
   * the containers use. Tests read artefacts back through it; browserhive
   * writes them through the internal name. Two names, one store.
   */
  s3: string;
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
    s3: process.env["E2E_S3_URL"] ?? "http://127.0.0.1:8333",
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
        "bring it up first: container-compose --profile meadow up -d -b",
    );
  }

  await assertMeadowIsCurrent(endpoints.meadow);
  await assertS3IsReachable(endpoints.s3);

  provide("api", endpoints.api);
  provide("meadow", endpoints.meadow);
  provide("s3", endpoints.s3);
}

/**
 * Fail early if SeaweedFS is not published to the host.
 *
 * The bucket rejects unsigned requests, so any HTTP answer at all — 403
 * included — proves the port is open; only a transport error means it is not.
 * Checked here rather than in the tests because the failure it catches is
 * "the stack was brought up from a compose file without the `ports` entry",
 * which reads as an inscrutable connection error from inside a test.
 */
const assertS3IsReachable = async (s3: string): Promise<void> => {
  const reachable = await fetch(s3)
    .then(() => true)
    .catch(() => false);
  if (!reachable) {
    throw new Error(
      `SeaweedFS is not reachable at ${s3} — the e2e suite reads capture ` +
        "artefacts back from it. Check that docker-compose.yml publishes " +
        '`127.0.0.1:8333:8333` on the seaweedfs service, then re-create the ' +
        "stack: pnpm run stack:down && pnpm run stack:up",
    );
  }
};

/**
 * Fail if the running meadow was not built from the commit we pin.
 *
 * A container nobody rebuilt keeps serving the fixtures it was baked with, and
 * the assertions that fail as a result fail for reasons that look like anything
 * but a stale image — a scenario that "does not exist", a counter that stays at
 * zero. Cheaper to ask up front.
 *
 * `revision` rather than `version`: a tag only moves at release time, so during
 * development every meadow build reports the same version and only the commit
 * tells them apart.
 *
 * `dev` means the image was built without being told where it came from, which
 * is exactly the state in which staleness goes unnoticed — so that fails too,
 * rather than passing on the grounds that nothing could be checked.
 */
const assertMeadowIsCurrent = async (meadow: string): Promise<void> => {
  const { revision } = (await fetch(`${meadow}/__version`).then((r) => r.json())) as {
    revision: string;
  };
  const pinned = execFileSync("git", ["-C", "meadow", "rev-parse", "--short", "HEAD"])
    .toString()
    .trim();

  if (revision === "dev") {
    throw new Error(
      "the meadow container does not record which commit it was built from — " +
        "bring the stack up with `pnpm run stack:up`, which passes it",
    );
  }
  if (revision !== pinned) {
    throw new Error(
      `the meadow container was built from ${revision}, but the submodule points at ${pinned} — ` +
        "rebuild it: pnpm run stack:up",
    );
  }
};

declare module "vitest" {
  export interface ProvidedContext {
    api: string;
    meadow: string;
    s3: string;
  }
}
