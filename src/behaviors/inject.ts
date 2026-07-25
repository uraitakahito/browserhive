/**
 * Behavior injection + execution (NODE side).
 *
 * Loads the esbuild-bundled runtime once, injects it into the page, runs the
 * enabled behaviors inside a single `page.evaluate`, and waits (best-effort)
 * for the freshly-started fetches to settle so they land in the WARC. The
 * in-page runner self-bounds via `timeoutMs`; callers still wrap this in the
 * usual `withTimeout` / `runOnStableContext` as an outer safety net.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Page } from "puppeteer";
import type {
  BehaviorConfig,
  BehaviorRequest,
  BehaviorRunReport,
  CustomBehavior,
} from "./types.js";

/**
 * Load the esbuild-bundled runtime lazily (on first capture, then cached) so
 * merely importing this module never touches disk — tests import the capture
 * chain from source, where the bundle lives at dist/src/behaviors/ rather than
 * next to this file. Primary path is co-located with the compiled inject.js
 * (correct in prod regardless of cwd); the dist-under-cwd path is the fallback
 * used when running from source.
 */
const RUNTIME_CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), "runtime.js"),
  join(process.cwd(), "dist", "src", "behaviors", "runtime.js"),
];
let runtimeSourceCache: string | undefined;
const getRuntimeSource = (): string => {
  if (runtimeSourceCache !== undefined) return runtimeSourceCache;
  for (const path of RUNTIME_CANDIDATES) {
    try {
      runtimeSourceCache = readFileSync(path, "utf8");
      return runtimeSourceCache;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    `behavior runtime bundle not found (looked in: ${RUNTIME_CANDIDATES.join(", ")}). Run \`npm run build:behaviors\`.`,
  );
};

/** Minimal typing for the object the runtime publishes on the page. */
interface InPageRunner {
  register(behaviorClassExpr: unknown): void;
  run(opts: {
    enabled: string[];
    timeoutMs: number;
    options: Record<string, Record<string, unknown>>;
  }): Promise<BehaviorRunReport>;
}
interface BehaviorGlobal {
  // The runtime publishes itself under this exact global name on the page.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  __bh_behaviors: InPageRunner;
}

interface ResolvedRun {
  enabled: string[];
  options: Record<string, Record<string, unknown>>;
  custom: CustomBehavior[];
}

/**
 * Merge server config with the per-request override into a concrete run:
 * the request's `builtins` (if any) replaces the enabled set; per-behavior
 * options are shallow-merged; custom behaviors are honoured only when the
 * server has `allowCustom` on.
 */
export const resolveBehaviorRun = (
  config: BehaviorConfig,
  request?: BehaviorRequest,
): ResolvedRun => {
  const enabled = request?.builtins ?? config.builtins;
  const options: Record<string, Record<string, unknown>> = {};
  for (const id of new Set([
    ...Object.keys(config.options),
    ...Object.keys(request?.options ?? {}),
    ...enabled,
  ])) {
    options[id] = { ...(config.options[id] ?? {}), ...(request?.options?.[id] ?? {}) };
  }
  const custom = config.allowCustom ? (request?.custom ?? []) : [];
  return { enabled, options, custom };
};

/**
 * Inject the runtime, register any custom behaviors, run the enabled set, and
 * settle. Returns undefined when nothing is enabled. Never throws for an
 * individual behavior — errors are captured per behavior in the report.
 */
export const runBehaviors = async (
  page: Page,
  config: BehaviorConfig,
  request?: BehaviorRequest,
): Promise<BehaviorRunReport | undefined> => {
  const resolved = resolveBehaviorRun(config, request);
  if (resolved.enabled.length === 0 && resolved.custom.length === 0) {
    return undefined;
  }

  // 1. Inject the runtime (defines __bh_behaviors + registers built-ins), then
  //    append client custom behaviors as `register(<class expression>)`.
  let source = getRuntimeSource();
  for (const c of resolved.custom) {
    source += `\n;globalThis.__bh_behaviors.register(${c.source});`;
  }
  await page.evaluate(source);

  // 2. Run — the runner returns a serializable report.
  const report = await page.evaluate(
    (opts) =>
      (globalThis as unknown as BehaviorGlobal).__bh_behaviors.run(opts),
    {
      enabled: [...resolved.enabled, ...resolved.custom.map((c) => c.id)],
      timeoutMs: config.timeoutMs,
      options: resolved.options,
    },
  );

  // 3. Best-effort: let scroll-triggered lazy loads and autofetch requests
  //    finish so they are recorded before the WARC is finalized.
  await page
    .waitForNetworkIdle({
      idleTime: config.idleTimeMs,
      timeout: config.idleTimeoutMs,
    })
    .catch(() => undefined);

  return report;
};
