# behaviors v1.0

Custom behaviors written against **runtime contract v1.0** — the `ctx.Lib`
helpers (`sleep`, `collectCandidateUrls`, `collectStyleSheetUrls`,
`scrollIntoView`), `ctx.opts`, `ctx.getState(msg, counter)`, and the
`static id` / `static isMatch()` / `async *run(ctx)` class shape.

See `../README.md` for the directory convention and the behavior file contract.

## Behaviors in this version

| Directory / file                | id                          | What it does |
| ------------------------------- | --------------------------- | ------------ |
| `www.apple.com/tv-gallery.js`   | `www.apple.com:tv-gallery`  | Advances the Apple TV+ gallery carousel and fetches every candidate URL (incl. `_2x`) of each revealed slide, so JS-carousel slides survive Retina replay (autofetch alone only reaches static `<picture>` variants). |
