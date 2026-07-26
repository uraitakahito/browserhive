# behaviors v1.0

Custom behaviors written against **runtime contract v1.0** — the `ctx.Lib`
helpers (`sleep`, `collectCandidateUrls`, `collectStyleSheetUrls`,
`scrollIntoView`), `ctx.opts`, `ctx.getState(msg, counter)`, and the
`static id` / `static isMatch()` / `async *run(ctx)` class shape.

See `../README.md` for the directory convention and the behavior file contract.

## Behaviors in this version

| Directory / file                | id                          | What it does |
| ------------------------------- | --------------------------- | ------------ |
| `www.apple.com/tv-gallery.js`   | `www.apple.com:tv-gallery`  | Retina fidelity for the Apple TV+ gallery. apple renders exactly one slide variant per DPR (the `<img>` carries no `srcset`), so a DPR-1 capture misses the `2x` and a Retina replay shows black slides. **The fix is to capture at DPR 2** (`--device-scale-factor 2`): the browser then loads and archives the `1960x1044` 2x itself. This behavior is a **best-effort** back-fill of the complementary 1x for DPR-1 replay — see the file header for the verified limits (the 1x is not reliably reachable at behavior time). |
