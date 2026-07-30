/**
 * Unit tests for the capture trace.
 *
 * Two things are worth pinning down here. First that `pageTrace` cannot fail a
 * capture: it writes into a page that may navigate out from under it, and an
 * observability feature that throws is worse than no feature. Second that
 * `archiveTraceLines` gets the arithmetic right — a response whose body was
 * dropped is still IN the archive, just unreplayable, and conflating that with
 * a blocked request would misreport the one thing this trace exists to show.
 */
import { describe, it, expect, vi } from "vitest";
import { pageTrace, archiveTraceLines, line, group } from "../../src/capture/page-trace.js";
import type { CapturePage } from "../../src/capture/capture-page.js";
import type { RecordingStats } from "../../src/capture/network-recorder-types.js";
import { createEmptyRecordingStats } from "../../src/capture/network-recorder-types.js";
import type { CompletenessReport } from "../../src/storage/wacz/index.js";

const fakePage = (evaluate: unknown): CapturePage => ({ evaluate }) as unknown as CapturePage;

const complete: CompletenessReport = { bodylessUrls: [], complete: true };

const statsWith = (over: Partial<RecordingStats>): RecordingStats => ({
  ...createEmptyRecordingStats(),
  ...over,
});

/** Flatten a group's title + items so assertions can search one array. */
const flatten = (lines: ReturnType<typeof archiveTraceLines>): string[] =>
  lines.flatMap((l) => (l.kind === "group" ? [l.text, ...l.items] : [l.text]));

describe("pageTrace", () => {
  it("swallows a rejected evaluate — a lost trace must not fail a capture", async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error("Execution context was destroyed"));
    await expect(
      pageTrace(fakePage(evaluate), "archive", [line("x")]),
    ).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("does not touch the page when there is nothing to say", async () => {
    const evaluate = vi.fn();
    await pageTrace(fakePage(evaluate), "archive", []);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("prefixes the group title so DevTools can filter on it", async () => {
    const evaluate = vi.fn().mockResolvedValue(undefined);
    await pageTrace(fakePage(evaluate), "interventions", [line("x")]);
    const payload = evaluate.mock.calls[0]?.[1] as { title: string };
    expect(payload.title).toBe("[bh] interventions");
  });
});

describe("archiveTraceLines", () => {
  it("counts a body-less record as IN the archive, not as blocked", () => {
    const lines = flatten(
      archiveTraceLines(
        statsWith({ totalRecorded: 10, totalTruncatedTaskCap: 2 }),
        complete,
      ),
    );
    // 10 stored with a body + 2 stored without = 12 records in the WARC.
    expect(lines[0]).toBe("in archive 12 (with body 10 / without body 2)");
  });

  it("reports blocked separately — those never reach the WARC at all", () => {
    const lines = flatten(
      archiveTraceLines(
        statsWith({
          totalRecorded: 10,
          totalBlocked: 3,
          samples: {
            blocked: ["https://a/x.gif", "https://a/y.js"],
            skippedContentType: [],
            truncatedTooLarge: [],
            truncatedTaskCap: [],
          },
        }),
        complete,
      ),
    );
    expect(lines[0]).toBe("in archive 10 (with body 10 / without body 0)");
    expect(lines).toContain("never archived 3 — blocked by pattern");
    expect(lines).toContain("https://a/x.gif");
    // Only 2 of the 3 were sampled, so the remainder is acknowledged.
    expect(lines).toContain("… 1 more");
  });

  it("names the flag that would have kept an over-cap body", () => {
    const lines = flatten(
      archiveTraceLines(statsWith({ totalTruncatedTaskCap: 1 }), complete),
    );
    expect(lines.some((l) => l.includes("--wacz-max-task-bytes"))).toBe(true);
  });

  it("surfaces bodyless URLs, which replay cannot recover", () => {
    const lines = flatten(
      archiveTraceLines(statsWith({ totalRecorded: 5 }), {
        bodylessUrls: ["https://a/logo_2x.png"],
        complete: false,
      }),
    );
    expect(lines.some((l) => l.startsWith("bodyless 1"))).toBe(true);
    expect(lines).toContain("https://a/logo_2x.png");
    expect(lines).toContain("complete = false");
  });

  it("stays quiet about categories that did not happen", () => {
    const lines = flatten(archiveTraceLines(statsWith({ totalRecorded: 7 }), complete));
    expect(lines.some((l) => l.includes("never archived"))).toBe(false);
    expect(lines.some((l) => l.includes("body omitted"))).toBe(false);
    expect(lines.some((l) => l.includes("bodyless"))).toBe(false);
  });
});

describe("line / group", () => {
  it("builds the two shapes the page renderer understands", () => {
    expect(line("a")).toEqual({ kind: "line", text: "a" });
    expect(group("t", ["a"])).toEqual({ kind: "group", text: "t", items: ["a"] });
  });
});
