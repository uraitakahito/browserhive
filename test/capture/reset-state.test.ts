import { describe, it, expect } from "vitest";
import {
  DEFAULT_RESET_STATE_OPTIONS,
  resolveResetStateSpec,
  type ResetStateOptions,
} from "../../src/capture/reset-state.js";

const both = (cookies: boolean, pageContext: boolean): ResetStateOptions => ({
  cookies,
  pageContext,
});

describe("DEFAULT_RESET_STATE_OPTIONS", () => {
  it("wipes both axes by default (current behaviour)", () => {
    expect(DEFAULT_RESET_STATE_OPTIONS).toEqual(both(true, true));
  });
});

describe("resolveResetStateSpec", () => {
  it("returns the supplied defaults when input is undefined", () => {
    const defaults = both(false, true);
    expect(resolveResetStateSpec(undefined, defaults)).toEqual(defaults);
  });

  it("returns a copy of defaults (not the same reference) when input is undefined", () => {
    // Caller must be free to mutate the resolved options without affecting
    // the shared server default. Spread copy guards against that.
    const defaults = both(true, true);
    const resolved = resolveResetStateSpec(undefined, defaults);
    expect(resolved).not.toBe(defaults);
    expect(resolved).toEqual(defaults);
  });

  it("forces both fields true on input === true, regardless of defaults", () => {
    expect(resolveResetStateSpec(true, both(false, false))).toEqual(both(true, true));
    expect(resolveResetStateSpec(true, both(true, false))).toEqual(both(true, true));
  });

  it("forces both fields false on input === false, regardless of defaults", () => {
    expect(resolveResetStateSpec(false, both(true, true))).toEqual(both(false, false));
    expect(resolveResetStateSpec(false, both(false, true))).toEqual(both(false, false));
  });

  it("merges per-field with defaults for partial spec objects", () => {
    expect(
      resolveResetStateSpec({ cookies: false }, both(true, true)),
    ).toEqual(both(false, true));
    expect(
      resolveResetStateSpec({ pageContext: false }, both(true, true)),
    ).toEqual(both(true, false));
  });

  it("uses spec values verbatim when both fields are supplied", () => {
    expect(
      resolveResetStateSpec(
        { cookies: true, pageContext: false },
        both(false, true),
      ),
    ).toEqual(both(true, false));
  });

  it("treats an empty object as 'use defaults verbatim'", () => {
    const defaults = both(false, true);
    expect(resolveResetStateSpec({}, defaults)).toEqual(defaults);
  });
});
