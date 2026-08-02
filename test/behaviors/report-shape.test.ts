/**
 * The two copies of `BehaviorRunReport` must stay in step.
 *
 * `src/behaviors/types.ts` is the Node-side declaration; the browser-side one
 * lives in `src/behaviors/runtime/types.ts` because `runtime/` is excluded
 * from the tsc build (it is bundled separately by esbuild and injected into
 * the page), so it cannot import from outside itself.
 *
 * Nothing makes them agree. The report crosses `page.evaluate`, which types
 * its result from the callback and not from what actually arrives, so a field
 * added to the browser copy alone is produced, serialized, received — and then
 * silently unreachable, because the Node type says it is not there. That is
 * exactly how `decisions` came to be computed on every capture and read by
 * nobody.
 *
 * Comparing types at runtime is not possible, so this compares the source
 * text: both declarations must name the same fields.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readFields = (relative: string): string[] => {
  const src = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  const start = src.indexOf("export interface BehaviorRunReport");
  expect(start, `BehaviorRunReport not found in ${relative}`).toBeGreaterThan(-1);
  // The `ran` element shape: everything between the first `{` after `ran:`
  // and its closing `}`.
  const ran = src.slice(src.indexOf("ran:", start));
  const body = ran.slice(ran.indexOf("{") + 1, ran.indexOf("}"));
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] ?? "").sort();
};

describe("BehaviorRunReport", () => {
  it("names the same fields on both sides of page.evaluate", () => {
    const node = readFields("../../src/behaviors/types.ts");
    const browser = readFields("../../src/behaviors/runtime/types.ts");

    expect(node).not.toHaveLength(0);
    expect(browser).toEqual(node);
  });

  it("carries decisions, which is the field the split was hiding", () => {
    // Named explicitly rather than left to the equality above: if someone
    // removes it from both copies the test still passes, and the archive goes
    // back to being unable to say it was cut short.
    expect(readFields("../../src/behaviors/types.ts")).toContain("decisions");
  });
});
