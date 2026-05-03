# `data/` — YAML inputs for the example client

YAML files consumed by `examples/data-client.ts` (run via
`node dist/examples/data-client.js --data data/<file>.yaml ...`). Every file
is a **YAML 1.2 sequence** of mappings with this shape:

```yaml
- labels: ["9202", "ANAHoldings"]   # parts of the captured filename
  url: https://www.ana.co.jp/group/

# YAML comments — the reason this directory moved off CSV — are allowed
# anywhere and carry rationale, fixture provenance, etc. without affecting
# the parsed structure.
- labels: ["543A", "Archion"]       # quote alphanumeric tickers
  url: https://www.archion.co.jp/
```

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `labels` | no (default `[]`) | array of strings | Joined with `-` to form the captured filename: `{taskId}_{correlationId}_{label1}-{label2}.{ext}`. Numeric YAML scalars (e.g. `9202`) are coerced to strings by the parser, but quote them anyway for visual consistency with alphanumeric tickers like `"543A"`. |
| `url` | yes | string | Target URL. |

The parser (`examples/data-file.ts`) is **strict**: any malformed entry
fails the whole file with a descriptive error pinpointing the offending
index. The previous CSV parser silently dropped malformed rows, which let
fixture rot accumulate unnoticed.

## Files

| File | Entries | Purpose |
|------|---------|---------|
| [`urls.yaml`](urls.yaml) | 51 | Smoke-test set. Major global brands (Apple, Microsoft, Amazon, NVIDIA, ...) — fast, predictable HTTP 200 pages used as a sanity check that the capture pipeline is wired up end-to-end. |
| [`nikkei225.yaml`](nikkei225.yaml) | 225 | Load-test set. Every Nikkei 225 constituent's corporate top page. A realistic mix of fast pages, redirect chains, banner-heavy pages, and rare 4xx/5xx — used to exercise concurrency, retry, and error-path code under a workload that resembles production. `labels` use `[<TickerCode>, <CompanyName>]` so the output filename carries both. |
| [`js-redirect.yaml`](js-redirect.yaml) | 6 | Regression fixture for `runOnStableContext` (`src/capture/page-capturer.ts`). Each URL performs a JS-driven navigation immediately after the initial DOMContentLoaded — locale switches (`/ → /ja/`, `/ → /jp/`) or English landing redirects (`imhds.co.jp/ → /corporate/index_en.html`). Before the helper landed, every entry surfaced as `internal: "Execution context was destroyed, ..."` in errorHistory and produced no screenshot; with the helper, all six should yield `status: success` with both JPEG and HTML written. Drawn from the `nikkei225.yaml` superset. |

## Adding a new YAML

1. Top-level must be a YAML sequence (`-` per entry); no wrapping object.
2. Quote every label, including numeric tickers, for visual uniformity.
3. Use `#` comments freely to record fixture provenance, the bug a row was
   added for, or any other rationale that would otherwise be lost.
4. If the new file is meant as a regression fixture for a specific code
   path, mirror `js-redirect.yaml`'s pattern: keep the file small, document
   the targeted code path in the file header and in this table, and
   reference it from the relevant docstring in `src/capture/`.
