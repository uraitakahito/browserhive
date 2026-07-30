/**
 * Unit tests for the behavior runner's decision trace.
 *
 * The runner drives behaviors by hand now (it needs the generator's return
 * value, which `for await` throws away), so two things need pinning: that the
 * decisions actually surface, and that the hand-rolled loop still closes the
 * generator when the deadline cuts it short. `for await` used to do that
 * closing for free; forgetting it would leave a behavior's `finally` unrun.
 */
import { describe, it, expect, vi } from "vitest";
import { BehaviorRunner } from "../../src/behaviors/runtime/runner.js";
import type {
  BehaviorClass,
  BehaviorCtx,
  BehaviorDecisions,
} from "../../src/behaviors/runtime/types.js";

/** A behavior that yields `steps` times and then reports `decisions`. */
const buildBehavior = (
  id: string,
  steps: number,
  decisions?: BehaviorDecisions,
  onClose?: () => void,
): BehaviorClass => {
  class Fake {
    static id = id;
    static isMatch(): boolean {
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async *run(ctx: BehaviorCtx): AsyncGenerator<{ msg: string }, BehaviorDecisions | undefined> {
      try {
        for (let i = 0; i < steps; i++) yield ctx.getState("step");
        return decisions;
      } finally {
        onClose?.();
      }
    }
  }
  return Fake;
};

const runOpts = (trace?: boolean) => ({
  enabled: ["x"],
  timeoutMs: 5_000,
  options: {},
  ...(trace !== undefined && { trace }),
});

describe("BehaviorRunner — decision trace", () => {
  it("says nothing when the capture did not ask for a trace", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => undefined);
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("x", 2, { stopped: "bottom reached" }));

    await runner.run(runOpts());

    expect(spy).not.toHaveBeenCalled();
    expect(groupSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    groupSpy.mockRestore();
  });

  it("prints each decision under a prefixed group", async () => {
    const lines: string[] = [];
    const groups: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((l: unknown) => {
      lines.push(String(l));
    });
    const grp = vi.spyOn(console, "group").mockImplementation((l: unknown) => {
      groups.push(String(l));
    });
    const end = vi.spyOn(console, "groupEnd").mockImplementation(() => undefined);

    const runner = new BehaviorRunner();
    runner.register(
      buildBehavior("autoscroll", 2, {
        stopped: "maxSteps 40 reached — bottom NOT reached",
      }),
    );
    await runner.run({ ...runOpts(true), enabled: ["autoscroll"] });

    expect(groups).toContain("[bh] autoscroll");
    expect(lines).toContain("stopped: maxSteps 40 reached — bottom NOT reached");
    expect(end).toHaveBeenCalled();
    log.mockRestore();
    grp.mockRestore();
    end.mockRestore();
  });

  it("closes the generator when the deadline cuts a behavior short", async () => {
    const closed = vi.fn();
    const runner = new BehaviorRunner();
    // Far more steps than the budget allows, so the deadline fires mid-run.
    runner.register(buildBehavior("x", 1_000, { stopped: "never reached" }, closed));

    const report = await runner.run({ ...runOpts(), timeoutMs: -1 });

    expect(report.timedOut).toBe(true);
    // The `finally` inside the behavior ran — i.e. `.return()` was called.
    expect(closed).toHaveBeenCalledOnce();
  });

  it("reports no decisions for a behavior that returns nothing", async () => {
    const grp = vi.spyOn(console, "group").mockImplementation(() => undefined);
    const runner = new BehaviorRunner();
    runner.register(buildBehavior("x", 1));

    await runner.run(runOpts(true));

    expect(grp).not.toHaveBeenCalled();
    grp.mockRestore();
  });
});
