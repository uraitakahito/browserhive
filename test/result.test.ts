import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, type Result } from "../src/result.js";

describe("Result", () => {
  describe("ok", () => {
    it("constructs a success Result", () => {
      const r = ok(42);
      expect(r).toEqual({ ok: true, value: 42 });
    });

    it("constructs a void success Result with no arguments", () => {
      const r = ok();
      expect(r).toEqual({ ok: true, value: undefined });
    });

    it("ok() is assignable to Result<void, E>", () => {
      const r: Result<void, string> = ok();
      expect(r.ok).toBe(true);
    });
  });

  describe("err", () => {
    it("constructs a failure Result", () => {
      const r = err("boom");
      expect(r).toEqual({ ok: false, error: "boom" });
    });
  });

  describe("isOk / isErr", () => {
    it("narrows success branch with isOk", () => {
      const r: Result<number, string> = ok(1);
      if (isOk(r)) {
        // Compile-time: r.value is number, r.error is unreachable
        expect(r.value).toBe(1);
      } else {
        throw new Error("isOk should have narrowed to success");
      }
    });

    it("narrows failure branch with isErr", () => {
      const r: Result<number, string> = err("nope");
      if (isErr(r)) {
        // Compile-time: r.error is string
        expect(r.error).toBe("nope");
      } else {
        throw new Error("isErr should have narrowed to failure");
      }
    });

    it("isOk returns false for err", () => {
      expect(isOk(err("x"))).toBe(false);
    });

    it("isErr returns false for ok", () => {
      expect(isErr(ok(0))).toBe(false);
    });
  });
});
