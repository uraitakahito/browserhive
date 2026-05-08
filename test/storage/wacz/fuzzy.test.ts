/**
 * `fuzzy.json` builder tests. Phase 6.4 contract: WACZ ships a forward-
 * looking strip-rule file at the archive root so replay engines that
 * honour it can match recorded responses against URLs whose cache-buster
 * params change every load.
 */
import { describe, it, expect } from "vitest";
import { buildFuzzyJson } from "../../../src/storage/wacz/fuzzy.js";

describe("buildFuzzyJson", () => {
  it("emits a versioned JSON object with one strip rule per param", () => {
    const bytes = buildFuzzyJson({ params: ["_", "cb", "nocache"] });
    const parsed = JSON.parse(bytes.toString("utf-8")) as {
      version: number;
      rules: { rule: string; name: string }[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.rules).toEqual([
      { rule: "strip-query-param", name: "_" },
      { rule: "strip-query-param", name: "cb" },
      { rule: "strip-query-param", name: "nocache" },
    ]);
  });

  it("emits an empty rules array when no params are supplied", () => {
    const bytes = buildFuzzyJson({ params: [] });
    const parsed = JSON.parse(bytes.toString("utf-8")) as {
      version: number;
      rules: unknown[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.rules).toEqual([]);
  });

  it("ends with a trailing newline so reproducible builds match", () => {
    const bytes = buildFuzzyJson({ params: ["_"] });
    expect(bytes.toString("utf-8").endsWith("\n")).toBe(true);
  });
});
