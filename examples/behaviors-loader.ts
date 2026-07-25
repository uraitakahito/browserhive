/**
 * Custom-behavior loader for the example client.
 *
 * Reads the `examples/behaviors/<version>/<host>/*.js` tree into an in-memory
 * registry keyed by directory name (an FQDN or a registrable domain), and
 * selects the behaviors that apply to a given capture host. The file walk and
 * the host-selection logic are split so the selection — the part with the
 * interesting rules — is a pure function that unit-tests without touching disk
 * (same rationale as `data-file.ts` being separate from `data-client.ts`).
 *
 * Each behavior file is a bare JavaScript class *expression*; its contents are
 * sent verbatim as the request's `behaviors.custom[].source` and injected as
 * `register(<source>)`. The generated `id` is `"<dir>:<basename>"`, which by
 * convention must equal the class's `static id` (the runner matches enabled
 * ids to registered classes by `static id`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CustomBehavior {
  id: string;
  source: string;
}

/** Behaviors indexed by directory name (an FQDN or a registrable domain). */
export type BehaviorRegistry = Map<string, CustomBehavior[]>;

const BEHAVIORS_ROOT = "examples/behaviors";

/**
 * Read `<root>/<version>/<dir>/*.js` once into a registry keyed by `<dir>`.
 * `root` is injectable so tests can point at a fixture tree. Missing version
 * directories yield an empty registry (custom behaviors are simply absent).
 */
export const loadBehaviorRegistry = (
  version: string,
  root: string = BEHAVIORS_ROOT,
): BehaviorRegistry => {
  const versionDir = join(root, version);
  const registry: BehaviorRegistry = new Map();
  if (!existsSync(versionDir)) return registry;

  for (const entry of readdirSync(versionDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // skip README.md and other loose files
    const dirName = entry.name;
    const behaviors: CustomBehavior[] = readdirSync(join(versionDir, dirName))
      .filter((file) => file.endsWith(".js"))
      .map((file) => ({
        id: `${dirName}:${file.replace(/\.js$/, "")}`,
        source: readFileSync(join(versionDir, dirName, file), "utf8"),
      }));
    if (behaviors.length > 0) registry.set(dirName, behaviors);
  }
  return registry;
};

/**
 * Behaviors that apply to `host`: the exact FQDN directory first, then the
 * registrable-domain directory (subdomain-wide). The registrable domain is the
 * naive last-two-labels join — good enough for the example client; a real
 * deployment wanting `example.co.jp` correctness would swap in a PSL lookup.
 */
export const selectForHost = (
  registry: BehaviorRegistry,
  host: string,
): CustomBehavior[] => {
  const registrable = host.split(".").slice(-2).join(".");
  const keys = registrable === host ? [host] : [host, registrable];
  return keys.flatMap((key) => registry.get(key) ?? []);
};
