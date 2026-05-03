import { describe, it, expect } from "vitest";
import { parseDataFile } from "../../examples/data-file.js";

describe("parseDataFile", () => {
  describe("happy path", () => {
    it("parses a minimal entry with string labels", () => {
      const yaml = `
- labels: ["Apple"]
  url: https://www.apple.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { labels: ["Apple"], url: "https://www.apple.com/" },
        ]);
      }
    });

    it("coerces numeric labels to strings (preserves prior CSV ticker semantics)", () => {
      const yaml = `
- labels: [9202, ANAHoldings]
  url: https://www.ana.co.jp/group/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.labels).toEqual(["9202", "ANAHoldings"]);
      }
    });

    it("preserves quoted alphanumeric tickers as strings", () => {
      const yaml = `
- labels: ["543A", Archion]
  url: https://www.archion.co.jp/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.labels).toEqual(["543A", "Archion"]);
      }
    });

    it("treats omitted labels as an empty array", () => {
      const yaml = `
- url: https://example.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([{ labels: [], url: "https://example.com/" }]);
      }
    });

    it("treats explicitly empty labels as an empty array", () => {
      const yaml = `
- labels: []
  url: https://example.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.labels).toEqual([]);
      }
    });

    it("ignores leading/trailing whitespace inside string labels and url", () => {
      const yaml = `
- labels: ["  Apple  "]
  url: "  https://www.apple.com/  "
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]).toEqual({
          labels: ["Apple"],
          url: "https://www.apple.com/",
        });
      }
    });

    it("preserves YAML comments (round-trips meaningful entries despite comment lines)", () => {
      const yaml = `
# Top-level comment about the fixture set
- labels: ["Apple"]
  url: https://www.apple.com/   # trailing comment

# Section divider
- labels: ["Microsoft"]
  url: https://www.microsoft.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.labels).toEqual(["Apple"]);
        expect(result.value[1]?.labels).toEqual(["Microsoft"]);
      }
    });

    it("returns an empty array for empty content", () => {
      expect(parseDataFile("")).toEqual({ ok: true, value: [] });
      expect(parseDataFile("\n# only a comment\n")).toEqual({ ok: true, value: [] });
    });
  });

  describe("error path", () => {
    it("rejects non-array top level", () => {
      const result = parseDataFile("just a string");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Top-level must be a YAML sequence/);
      }
    });

    it("rejects entries that are not mappings", () => {
      const yaml = `
- "just a string"
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[0\]: expected mapping/);
      }
    });

    it("rejects entries missing url", () => {
      const yaml = `
- labels: ["Apple"]
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[0\].url: required non-empty string/);
      }
    });

    it("rejects entries with empty url", () => {
      const yaml = `
- labels: ["Apple"]
  url: "   "
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[0\].url: required non-empty string/);
      }
    });

    it("rejects labels of wrong type", () => {
      const yaml = `
- labels: "not-an-array"
  url: https://example.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[0\].labels: expected array/);
      }
    });

    it("rejects labels containing null/object/array", () => {
      const yaml = `
- labels: ["Apple", null]
  url: https://example.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[0\].labels\[1\]/);
      }
    });

    it("rejects empty-string labels", () => {
      const yaml = `
- labels: ["Apple", ""]
  url: https://example.com/
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[0\].labels\[1\]: empty string/);
      }
    });

    it("reports a descriptive error on malformed YAML syntax", () => {
      const result = parseDataFile("- labels: [unterminated\n  url: https://example.com/");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/^YAML parse error:/);
      }
    });

    it("pinpoints the first offending entry index across multiple entries", () => {
      const yaml = `
- labels: ["Apple"]
  url: https://www.apple.com/

- labels: ["Microsoft"]
  # url is missing
`;
      const result = parseDataFile(yaml);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/entry\[1\]/);
      }
    });
  });
});
