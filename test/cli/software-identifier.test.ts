/**
 * The version an archive claims to have been made by.
 *
 * `software` goes into `datapackage.json` and into the WARC `warcinfo`
 * record, which means it is **baked into every archive** and outlives the
 * process that wrote it. A wrong value there cannot be corrected later; it is
 * simply what that archive says about itself, forever.
 *
 * It said `browserhive/1.0.0` through every release up to v1.15.0, because it
 * was read straight from `package.json` — a field nothing in this workspace
 * keeps in step with releases. `scripts/generate-version.mjs` exists precisely
 * because of that, and says so in its own comment: "package.json is not the
 * answer … the tag is what a release IS here, so ask git for it." Its output,
 * `BUILD_INFO`, was already correct and already being served at
 * `/v1/status.build`. Only the archives were reading the wrong source.
 *
 * This pins the source rather than the value: the number changes every
 * release, but where it comes from must not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SOFTWARE_IDENTIFIER } from "../../src/cli/server-cli.js";
import { BUILD_INFO } from "../../src/generated/version.js";

describe("the software identifier an archive is stamped with", () => {
  it("comes from the build fingerprint, which resolves from the git tag", () => {
    expect(SOFTWARE_IDENTIFIER).toBe(`browserhive/${BUILD_INFO.version}`);
  });

  it("does not come from package.json", () => {
    // The defect this file exists for. package.json has said 1.0.0 since the
    // day it was written, through every tag; an archive stamped from it names
    // a release nobody can fetch.
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { version: string };

    // Only meaningful while the two actually differ — which is the normal
    // state here, and the whole reason the generator exists. If someone ever
    // makes package.json track releases this assertion stops discriminating,
    // so it is guarded rather than silently vacuous.
    expect(
      pkg.version,
      "package.json now matches the build version — this test no longer discriminates",
    ).not.toBe(BUILD_INFO.version);
    expect(SOFTWARE_IDENTIFIER).not.toBe(`browserhive/${pkg.version}`);
  });
});
