/**
 * Unit tests for how the runner picks which behaviors run — specifically the
 * site-behavior rule: bundled site behaviors are considered on every capture
 * without being named in `enabled`, and `isMatch()` decides from there.
 *
 * Uses a fresh `BehaviorRunner` per test so the singleton's built-in
 * registrations do not leak in.
 */
import { describe, it, expect } from "vitest";
import { BehaviorRunner } from "../../src/behaviors/runtime/runner.js";
import type { BehaviorClass, BehaviorCtx } from "../../src/behaviors/runtime/types.js";

/** Records the order behaviors actually ran in. */
const buildBehavior = (
  id: string,
  opts: { matches: boolean; siteSpecific?: boolean; ran: string[] },
): BehaviorClass => {
  class Fake {
    static id = id;
    static siteSpecific = opts.siteSpecific;
    static isMatch(): boolean {
      return opts.matches;
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async *run(ctx: BehaviorCtx): AsyncGenerator<{ msg: string }> {
      opts.ran.push(id);
      yield ctx.getState("step");
    }
  }
  return Fake as unknown as BehaviorClass;
};

const runOpts = (enabled: string[], siteBehaviors?: boolean) => ({
  enabled,
  timeoutMs: 5_000,
  options: {},
  ...(siteBehaviors !== undefined && { siteBehaviors }),
});

describe("BehaviorRunner — site behaviors", () => {
  it("runs a site behavior even though it is not in `enabled`", async () => {
    const ran: string[] = [];
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("site:x/demo", { matches: true, siteSpecific: true, ran }));

    const report = await runner.run(runOpts([]));

    expect(ran).toEqual(["site:x/demo"]);
    expect(report.ran.map((r) => r.id)).toEqual(["site:x/demo"]);
  });

  it("does not run it when isMatch() is false (harmless on other sites)", async () => {
    const ran: string[] = [];
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("site:x/demo", { matches: false, siteSpecific: true, ran }));

    const report = await runner.run(runOpts([]));

    expect(ran).toEqual([]);
    expect(report.ran).toEqual([]);
  });

  it("runs site behaviors after the requested built-ins", async () => {
    const ran: string[] = [];
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("site:x/demo", { matches: true, siteSpecific: true, ran }));
    runner.register(buildBehavior("autoscroll", { matches: true, ran }));

    await runner.run(runOpts(["autoscroll"]));

    expect(ran).toEqual(["autoscroll", "site:x/demo"]);
  });

  it("skips site behaviors when siteBehaviors is false", async () => {
    const ran: string[] = [];
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("site:x/demo", { matches: true, siteSpecific: true, ran }));
    runner.register(buildBehavior("autoscroll", { matches: true, ran }));

    await runner.run(runOpts(["autoscroll"], false));

    expect(ran).toEqual(["autoscroll"]);
  });

  it("leaves ordinary built-ins opt-in: not enabled means not run", async () => {
    const ran: string[] = [];
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("autoplay", { matches: true, ran }));

    await runner.run(runOpts([]));

    expect(ran).toEqual([]);
  });
});
