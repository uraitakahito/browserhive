# behaviors v1.0

Custom behaviors written against **runtime contract v1.0** — the `ctx.Lib`
helpers (`sleep`, `collectCandidateUrls`, `collectStyleSheetUrls`,
`scrollIntoView`), `ctx.opts`, `ctx.getState(msg, counter)`, and the
`static id` / `static isMatch()` / `async *run(ctx)` class shape.

See `../README.md` for the directory convention and the behavior file contract.

## Behaviors in this version

None. The Apple TV+ gallery behavior that used to live here is now **bundled
into the server** (`src/behaviors/runtime/site/apple.ts`) and runs automatically
on matching hosts — no client JavaScript, and no `--allow-custom-behaviors`.

This directory stays as the place for behaviors the **server does not ship**:
drop a `<host>/<name>.js` here and the example client attaches it to captures of
that host. See `../README.md` for the convention and the file contract.
