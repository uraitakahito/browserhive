/**
 * `pages.jsonl` generator for WACZ.
 *
 * One line per "primary capture" (in BrowserHive's per-task model: exactly
 * one). The `ts` field is the contract Phase 6.1 hangs the clock-fixing
 * behaviour on: ReplayWeb.page injects wombat shims that override
 * `Date.now()` / `Math.random()` / `crypto.getRandomValues()` based on this
 * timestamp, so JS that bakes `Date.now()` into a URL re-emits the same
 * URL on replay and matches a recorded response.
 */

export interface PagesLineInput {
  /** Page entry ID. Use the BrowserHive task ID so logs cross-reference. */
  id: string;
  url: string;
  /** ISO 8601 timestamp of when the capture finished. */
  ts: string;
  /** `<title>` of the captured page. May be empty. */
  title: string;
}

/** First line of `pages.jsonl` is a header object per WACZ 1.1 spec. */
const PAGES_HEADER = JSON.stringify({
  format: "json-pages-1.0",
  id: "pages",
  title: "All Pages",
});

export const buildPagesJsonl = (inputs: PagesLineInput[]): string => {
  const lines = [PAGES_HEADER];
  for (const p of inputs) {
    lines.push(
      JSON.stringify({
        id: p.id,
        url: p.url,
        ts: p.ts,
        title: p.title,
      }),
    );
  }
  return `${lines.join("\n")}\n`;
};
