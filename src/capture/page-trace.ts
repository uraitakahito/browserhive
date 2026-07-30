/**
 * Observability trace written into the *captured page's* console, for reading
 * over `chrome://inspect` next to the live screencast.
 *
 * Scope is deliberately narrow: only what DevTools cannot work out by itself.
 * Timings are excluded — the Network and Performance panels show those better,
 * and duplicating them here would just be noise. What is left is what
 * BrowserHive did to the page, what its behaviors decided, and which responses
 * never reached the archive.
 *
 * The behavior runtime writes its own group from inside the page (it already
 * runs there); everything else is pushed from Node through this module.
 */
import type { CapturePage } from "./capture-page.js";
import type { RecordingStats } from "./network-recorder-types.js";
import type { CompletenessReport } from "../storage/wacz/index.js";

/** Every traced line carries this prefix so it can be filtered in DevTools. */
export const TRACE_PREFIX = "[bh]";

/** One line, or a nested collapsible group of lines. */
export type TraceLine =
  | { kind: "line"; text: string }
  | { kind: "group"; text: string; items: string[] };

export const line = (text: string): TraceLine => ({ kind: "line", text });

export const group = (text: string, items: string[]): TraceLine => ({
  kind: "group",
  text,
  items,
});

/**
 * Emit one complete console group into the page.
 *
 * Atomic on purpose. Opening a group in one `evaluate` and closing it in a
 * later one would leave it open whenever anything in between throws, and every
 * line the page logged afterwards would nest inside it — the console would get
 * steadily more indented and never recover. One call, one balanced group.
 *
 * Never throws. A navigation destroys the execution context and makes
 * `evaluate` reject; an observability feature must not be able to fail a
 * capture, so the rejection is swallowed and the trace is simply lost.
 */
export const pageTrace = async (
  page: CapturePage,
  title: string,
  lines: TraceLine[],
): Promise<void> => {
  if (lines.length === 0) return;
  await page
    .evaluate(
      (payload: { title: string; lines: TraceLine[] }) => {
        console.group(payload.title);
        for (const entry of payload.lines) {
          if (entry.kind === "group") {
            console.group(entry.text);
            for (const item of entry.items) console.log(item);
            console.groupEnd();
          } else {
            console.log(entry.text);
          }
        }
        console.groupEnd();
      },
      { title: `${TRACE_PREFIX} ${title}`, lines },
    )
    .catch(() => undefined);
};

/** Format a byte count for a human skimming the console. */
const bytes = (n: number): string =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)}MB`
    : `${String(Math.round(n / 1024))}KB`;

/**
 * Build the `archive` group: what did NOT reach the archive, and why.
 *
 * A pure function over the numbers the recorder already produced, so the
 * wording is unit-testable without a browser.
 *
 * The arithmetic is easy to get wrong. `totalRecorded` counts pairs stored
 * WITH a body; a response whose body was dropped (content-type, too large,
 * task cap) is still written to the WARC, just without one — it is in the
 * archive but cannot be replayed. Only `totalBlocked` never reaches the WARC
 * at all. The three are reported separately for that reason.
 */
export const archiveTraceLines = (
  stats: RecordingStats,
  completeness: CompletenessReport,
): TraceLine[] => {
  const omitted =
    stats.totalSkippedContentType +
    stats.totalTruncatedTooLarge +
    stats.totalTruncatedTaskCap;

  const lines: TraceLine[] = [
    line(
      `in archive ${String(stats.totalRecorded + omitted)} ` +
        `(with body ${String(stats.totalRecorded)} / without body ${String(omitted)})`,
    ),
  ];

  if (stats.totalBlocked > 0) {
    lines.push(
      group(`never archived ${String(stats.totalBlocked)} — blocked by pattern`, [
        ...stats.samples.blocked,
        ...(stats.totalBlocked > stats.samples.blocked.length
          ? [`… ${String(stats.totalBlocked - stats.samples.blocked.length)} more`]
          : []),
      ]),
    );
  }

  if (omitted > 0) {
    lines.push(
      group(`body omitted ${String(omitted)} — in the archive, not replayable`, [
        ...(stats.totalSkippedContentType > 0
          ? [
              `content-type ${String(stats.totalSkippedContentType)}`,
              ...stats.samples.skippedContentType.map((u) => `  ${u}`),
            ]
          : []),
        ...(stats.totalTruncatedTooLarge > 0
          ? [
              `too-large ${String(stats.totalTruncatedTooLarge)} — raise --wacz-max-response-bytes`,
              ...stats.samples.truncatedTooLarge.map((u) => `  ${u}`),
            ]
          : []),
        ...(stats.totalTruncatedTaskCap > 0
          ? [
              `task-cap ${String(stats.totalTruncatedTaskCap)} — raise --wacz-max-task-bytes`,
              ...stats.samples.truncatedTaskCap.map((u) => `  ${u}`),
            ]
          : []),
      ]),
    );
  }

  if (!completeness.complete) {
    lines.push(
      group(
        `bodyless ${String(completeness.bodylessUrls.length)} — seen only as 304, replay cannot recover`,
        completeness.bodylessUrls.slice(0, 5),
      ),
    );
  }

  lines.push(
    line(
      `failed ${String(stats.totalFailed)}  ` +
        `incomplete ${String(stats.totalIncomplete)}  ` +
        `body ${bytes(stats.totalBodyBytes)}`,
    ),
    line(`complete = ${String(completeness.complete)}`),
  );

  return lines;
};
