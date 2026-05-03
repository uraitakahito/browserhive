# `data/` — CSV inputs for the example client

CSV files consumed by `examples/csv-client.ts` (run via
`node dist/examples/csv-client.js --csv data/<file>.csv ...`). All files share
the same two-column shape:

| column | description |
|--------|-------------|
| `labels` | Display label baked into the output filename. May contain `\|` to encode multiple labels in a single cell (e.g. `9202\|ANAHoldings` → emitted as `9202-ANAHoldings` in the captured filename). |
| `url`    | Target URL to capture. |

## Files

| File | Rows | Purpose |
|------|------|---------|
| [`urls.csv`](urls.csv) | 51 | Smoke-test set. Major global brands (Apple, Microsoft, Amazon, NVIDIA, ...) — fast, predictable HTTP 200 pages used as a sanity check that the capture pipeline is wired up end-to-end. |
| [`nikkei225.csv`](nikkei225.csv) | 225 | Load-test set. Every Nikkei 225 constituent's corporate top page. A realistic mix of fast pages, redirect chains, banner-heavy pages, and rare 4xx/5xx — used to exercise concurrency, retry, and error-path code under a workload that resembles production. `labels` use `<TickerCode>\|<CompanyName>` so the output filename carries both. |
| [`js-redirect.csv`](js-redirect.csv) | 6 | Regression fixture for `runOnStableContext` (`src/capture/page-capturer.ts`). Each URL performs a JS-driven navigation immediately after the initial DOMContentLoaded — locale switches (`/ → /ja/`, `/ → /jp/`) or English landing redirects (`imhds.co.jp/ → /corporate/index_en.html`). Before the helper landed, every entry surfaced as `internal: "Execution context was destroyed, ..."` in errorHistory and produced no screenshot; with the helper, all six should yield `status: success` with both JPEG and HTML written. Drawn from the `nikkei225.csv` superset. |

## Adding a new CSV

1. Match the `labels,url` header exactly — the example client splits on the
   first comma so labels containing commas are not supported.
2. Keep `\|`-separated labels for multi-label rows; the client converts `\|`
   → `-` when writing the output filename.
3. If the new file is meant as a regression fixture for a specific code
   path, mirror `js-redirect.csv`'s pattern: keep the file small, document
   the targeted code path here, and reference it from the relevant
   docstring in `src/capture/`.
