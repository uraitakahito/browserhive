/**
 * Unit tests for resolveBehaviorRun — the Node-side merge of server behavior
 * config with a per-request override.
 */
import { describe, it, expect } from "vitest";
import { resolveBehaviorRun } from "../../src/behaviors/inject.js";
import type { BehaviorConfig } from "../../src/behaviors/types.js";

const baseConfig = (over: Partial<BehaviorConfig> = {}): BehaviorConfig => ({
  builtins: ["autoscroll", "autofetch"],
  timeoutMs: 30000,
  allowCustom: false,
  options: { autoscroll: { maxSteps: 40 }, autofetch: { maxUrls: 2000 } },
  idleTimeMs: 1000,
  idleTimeoutMs: 15000,
  ...over,
});

describe("resolveBehaviorRun", () => {
  it("uses the server default enabled set when no request override", () => {
    const r = resolveBehaviorRun(baseConfig());
    expect(r.enabled).toEqual(["autoscroll", "autofetch"]);
    expect(r.custom).toEqual([]);
  });

  it("lets a request builtins override replace the enabled set", () => {
    const r = resolveBehaviorRun(baseConfig(), { builtins: ["autofetch"] });
    expect(r.enabled).toEqual(["autofetch"]);
  });

  it("merges per-behavior options over the server options", () => {
    const r = resolveBehaviorRun(baseConfig(), {
      options: { autoscroll: { maxSteps: 60 } },
    });
    expect(r.options.autoscroll).toEqual({ maxSteps: 60 });
    expect(r.options.autofetch).toEqual({ maxUrls: 2000 });
  });

  it("drops custom behaviors when the server does not allow them", () => {
    const r = resolveBehaviorRun(baseConfig({ allowCustom: false }), {
      custom: [{ id: "x", source: "class {}" }],
    });
    expect(r.custom).toEqual([]);
  });

  it("keeps custom behaviors when the server allows them", () => {
    const r = resolveBehaviorRun(baseConfig({ allowCustom: true }), {
      custom: [{ id: "x", source: "class {}" }],
    });
    expect(r.custom).toEqual([{ id: "x", source: "class {}" }]);
  });
});
