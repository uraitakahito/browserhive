import { describe, it, expect } from "vitest";
import {
  loadBehaviorRegistry,
  selectForHost,
  type BehaviorRegistry,
} from "../../examples/behaviors-loader.js";

const FIXTURE_ROOT = "test/examples/fixtures/behaviors";

describe("loadBehaviorRegistry", () => {
  it("indexes each host/domain subdirectory's *.js by <dir>:<basename>", () => {
    const registry = loadBehaviorRegistry("v1.0", FIXTURE_ROOT);

    expect([...registry.keys()].sort()).toEqual([
      "example.com",
      "www.example.com",
    ]);

    const apple = registry.get("www.example.com");
    expect(apple?.map((b) => b.id)).toEqual(["www.example.com:probe"]);
    expect(apple?.[0]?.source).toContain("class {");

    expect(registry.get("example.com")?.[0]?.id).toBe("example.com:shared");
  });

  it("ignores non-.js files inside a host directory", () => {
    const registry = loadBehaviorRegistry("v1.0", FIXTURE_ROOT);
    const ids = registry.get("www.example.com")?.map((b) => b.id) ?? [];
    // notes.txt lives beside probe.js but must not appear.
    expect(ids).toEqual(["www.example.com:probe"]);
  });

  it("skips loose files directly under the version directory (README.md)", () => {
    const registry = loadBehaviorRegistry("v1.0", FIXTURE_ROOT);
    expect(registry.has("README.md")).toBe(false);
  });

  it("returns an empty registry for a missing version directory", () => {
    const registry = loadBehaviorRegistry("v9.9", FIXTURE_ROOT);
    expect(registry.size).toBe(0);
  });
});

describe("selectForHost", () => {
  const registry: BehaviorRegistry = new Map([
    ["www.apple.com", [{ id: "www.apple.com:tv-gallery", source: "class {}" }]],
    ["apple.com", [{ id: "apple.com:promo", source: "class {}" }]],
  ]);

  it("collects the exact FQDN directory then the registrable domain", () => {
    expect(selectForHost(registry, "www.apple.com").map((b) => b.id)).toEqual([
      "www.apple.com:tv-gallery",
      "apple.com:promo",
    ]);
  });

  it("uses only the domain bucket when the host is already registrable", () => {
    expect(selectForHost(registry, "apple.com").map((b) => b.id)).toEqual([
      "apple.com:promo",
    ]);
  });

  it("returns nothing for an unknown host", () => {
    expect(selectForHost(registry, "www.example.org")).toEqual([]);
  });
});
