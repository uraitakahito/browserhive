import { describe, it, expect } from "vitest";
import { INLINE_FORMATS } from "../../src/http/ajv-formats-inline.js";

const runFormat = (name: string, value: string): boolean => {
  const fmt = INLINE_FORMATS[name];
  if (typeof fmt === "function") return fmt(value);
  if (fmt instanceof RegExp) return fmt.test(value);
  throw new Error(`Format "${name}" is not callable in this test`);
};

describe("INLINE_FORMATS.uri", () => {
  it.each([
    "https://example.com",
    "http://x:8080/p?q=1",
    "https://www.theguardian.com",
    "mailto:a@b.example",
    "about:blank",
  ])("accepts %s", (input) => {
    expect(runFormat("uri", input)).toBe(true);
  });

  it.each(["", "not a url", "://nope"])("rejects %s", (input) => {
    expect(runFormat("uri", input)).toBe(false);
  });

  // WHATWG URL parser strips leading/trailing ASCII whitespace, matching
  // what Puppeteer/Chromium would accept downstream — document this here
  // so the behavior cannot quietly change.
  it("normalizes (and accepts) URIs with leading whitespace", () => {
    expect(runFormat("uri", "  https://example.com")).toBe(true);
  });
});

describe("INLINE_FORMATS.uuid", () => {
  it.each([
    "550e8400-e29b-41d4-a716-446655440000",
    "550E8400-E29B-41D4-A716-446655440000",
    "abcdef12-3456-7890-abcd-ef1234567890",
  ])("accepts %s", (input) => {
    expect(runFormat("uuid", input)).toBe(true);
  });

  it.each([
    "550e8400",
    "550e8400-e29b-41d4-a716-44665544000",
    "550e8400-e29b-41d4-a716-4466554400000",
    "550e8400e29b41d4a716446655440000",
    "zzzzzzzz-e29b-41d4-a716-446655440000",
    " 550e8400-e29b-41d4-a716-446655440000",
    "",
  ])("rejects %s", (input) => {
    expect(runFormat("uuid", input)).toBe(false);
  });
});

describe("INLINE_FORMATS.date-time", () => {
  it("accepts new Date().toISOString() output", () => {
    expect(runFormat("date-time", new Date().toISOString())).toBe(true);
  });

  it.each([
    "2026-05-04T12:34:56Z",
    "2026-05-04T12:34:56.123Z",
    "2026-05-04T12:34:56+09:00",
    "2026-05-04T12:34:56.123456-05:00",
  ])("accepts %s", (input) => {
    expect(runFormat("date-time", input)).toBe(true);
  });

  it.each([
    "2026-05-04",
    "2026-05-04T12:34:56",
    "2026-05-04 12:34:56Z",
    "not a date",
    "",
  ])("rejects %s", (input) => {
    expect(runFormat("date-time", input)).toBe(false);
  });
});
