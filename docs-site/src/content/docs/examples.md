---
title: Examples
description: The dev-only utilities under examples/ — the YAML-driven capture client, its data-file parser, the custom-behavior loader, and the fixtures in data/
---

`examples/` holds utilities for driving a running server by hand. They are
**development-only**: the production build compiles `src` + `bin` only, so
nothing here reaches the runtime image.

| File | What it is |
|---|---|
| [`examples/data-client.ts`](https://github.com/uraitakahito/browserhive/blob/main/examples/data-client.ts) | A client that submits captures from a YAML file |
| [`examples/data-file.ts`](https://github.com/uraitakahito/browserhive/blob/main/examples/data-file.ts) | The YAML format and its parser |
| [`examples/behaviors-loader.ts`](https://github.com/uraitakahito/browserhive/blob/main/examples/behaviors-loader.ts) | Loads client-supplied custom behaviors by host |
| [`examples/behaviors/`](https://github.com/uraitakahito/browserhive/tree/main/examples/behaviors) | Where those behavior files live |

The two loaders are separate modules rather than code inside the client for one
reason: the client's entry point is an IIFE that talks to a server, while
parsing a data file and choosing behaviors for a host are pure functions. Split
out, they are unit-tested without a server or a disk.

## Building them

`pnpm run build` does not emit them — it uses [`tsconfig.build.json`](https://github.com/uraitakahito/browserhive/blob/main/tsconfig.build.json), which ships
`src` + `bin` only. Use the separate build:

```sh
pnpm run build:examples
```

That compiles `src` + `bin` + `examples` via [`tsconfig.examples.json`](https://github.com/uraitakahito/browserhive/blob/main/tsconfig.examples.json), so
`dist/examples/*.js` can resolve its `../src/*.js` imports against `dist/src`.

## `data-client.ts` — submit captures from a YAML file

Reads a list of URLs and submits one capture request each, fire-and-forget: the
client gets a `202` with a `taskId` and stops there. The captures themselves
happen asynchronously on the server, so completion is not something this script
waits for — see [Capture results](/capture-results/) for how to find out what
became of a task.

It calls the **operationId-keyed SDK generated from
[`src/http/openapi.yaml`](https://github.com/uraitakahito/browserhive/blob/main/src/http/openapi.yaml)**,
so paths, methods and request/response shapes all come from the spec. There are
no hardcoded URL strings in the example, which is the point of shipping it: it
doubles as a check that the generated client is usable.

```sh
node dist/examples/data-client.js \
  --data data/smoke-test.yaml --webp --html --links --limit 30 \
  --accept-language "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" \
  | pino-pretty
```

Point it at a running server — the container stack or the host dev loop from
[Development environment](/development-environment/). With no `--server` it uses
the base URL baked into the generated SDK (`servers[0].url` in the spec), which
is `localhost:8080`.

Piping through `pino-pretty` is optional; the raw output is JSON lines. The
client logs its resolved configuration, how many entries it loaded out of how
many the file held, then a summary once every request has been accepted.

### Options

Flags are defined in [`src/cli/client-cli.ts`](https://github.com/uraitakahito/browserhive/blob/main/src/cli/client-cli.ts). `--data` is required, and so is
**at least one capture format** — the server rejects a request with none
(`validateCaptureFormats`).

| Flag | Purpose |
|---|---|
| `--data <path>` | YAML data file. **Required.** |
| `--server <url>` | Server base URL. Env: `BROWSERHIVE_SERVER`. |
| `--limit <n>` | Read at most `n` entries from the file. |
| `--png` `--webp` | Screenshots. |
| `--html` | DOM snapshot after JavaScript ran. |
| `--links` | Extract `<a href>` to a `.links.json`. |
| `--mhtml` | Single-file MHTML archive (CDP `Page.captureSnapshot`). |
| `--wacz` | Record the whole HTTP session as a WACZ — see [Replay quickstart](/replay-quickstart/). |
| `--full-page` | Capture the full document height, not just the viewport. |
| `--viewport-width <px>` `--viewport-height <px>` | Per-request viewport. Must be given as a pair. |
| `--device-scale-factor <n>` | Device pixel ratio. `2` picks up the 2x responsive-image candidates. |
| `--archive-mode <mode>` | `single-pass` (default) or `multipass` — one pass per DPR into a single WACZ, browser cache disabled. |
| `--accept-language <bcp47>` | `Accept-Language` forwarded upstream for every entry. |
| `--dismiss-banners` | Best-effort banner / modal dismissal before capturing. |
| `--operation-delay-ms <ms>` | Slow every browser operation down so the capture can be watched live. `0` = off. See [Development environment](/development-environment/). |
| `--behaviors-version <v>` | Which `examples/behaviors/<v>/` to load. Default `v1.0`. |
| `--tls-ca-cert <path>` | CA certificate; specifying it enables TLS. Env: `BROWSERHIVE_TLS_CA_CERT`. See [TLS certificates](/tls-certificates/). |

Every per-request flag overrides the server's default for that request only.
The server-wide equivalents are on [Environment variables](/environment-variables/).

## `data-file.ts` — the YAML format

A top-level array of mappings, each with `labels` and a `url`:

```yaml
- labels: [9202, ANAHoldings]
  url: https://www.ana.co.jp/group/

- labels: ["543A", Archion]   # quote alphanumeric tickers
  url: https://www.archion.co.jp/
```

`labels` end up in the artifact filenames, which is why alphanumeric tickers
need quoting — YAML would otherwise read `543A` as a string but `9202` as a
number. Numbers are coerced to strings so callers always see `string[]`.

The parser is **strict on purpose**: one malformed entry fails the whole parse
with an error naming the offending index. Its predecessor was a CSV parser that
silently dropped malformed rows, which let fixture rot pile up unnoticed — a
hard error matches the `Result`-based error handling used elsewhere
([`src/result.ts`](https://github.com/uraitakahito/browserhive/blob/main/src/result.ts)).

## `behaviors-loader.ts` — client-supplied behaviors

Behaviors for hosts BrowserHive already supports are **bundled into the server**
and need nothing from the client. This loader is for the sites the server does
not cover yet.

It reads `examples/behaviors/<version>/<host>/*.js` into a registry keyed by
directory name, then picks the entries that apply to each capture's host —
trying the **FQDN** directory first (`www.apple.com`), then the **registrable
domain** (`apple.com`, covering every subdomain).

```
examples/behaviors/
└─ v1.0/                      # runtime-contract version, chosen by --behaviors-version
   └─ www.apple.com/          # FQDN, or a registrable domain
      └─ tv-gallery.js        # a bare class expression
```

Each file is a bare JavaScript class *expression* — no `export`, no name — sent
verbatim as the request's `behaviors.custom[].source` and injected as
`register(<source>)`. The id the loader generates is `"<dir>:<basename>"`, and
it **must** equal the class's `static id`, because the runner matches enabled
ids against registered classes by that field. So
`www.apple.com/tv-gallery.js` must declare
`static id = "www.apple.com:tv-gallery"`.

These files reference DOM globals and run inside the page, so they are text
templates rather than compiled modules — excluded from both tsc and ESLint.

The server only honours custom behaviors when started with
`--allow-custom-behaviors`. What the class must implement, what `ctx` offers,
and how to read the resulting `behaviorReport` are on
[Behaviors](/behaviors/).

`v1.0` in the path is the **runtime contract** version, not the behavior's own
version: it pins the `ctx.Lib` API and the `static id` / `isMatch` / `async *run`
shape. A breaking contract change gets a new directory, and behaviors under the
old one keep working.

## `data/` — the fixtures

Four data files ship with the repo, each for a different job:

| File | Entries | What it is for |
|---|---|---|
| [`data/smoke-test.yaml`](https://github.com/uraitakahito/browserhive/blob/main/data/smoke-test.yaml) | ~51 | Major global brands — fast, predictable 200s. A sanity check that the pipeline is wired up end to end. |
| [`data/nikkei225.yaml`](https://github.com/uraitakahito/browserhive/blob/main/data/nikkei225.yaml) | 225 | Every Nikkei 225 constituent's top page. A realistic mix of fast pages, redirect chains, banner-heavy pages and the occasional 4xx/5xx — used to exercise concurrency, retry and error paths under load. |
| [`data/accept-language.yaml`](https://github.com/uraitakahito/browserhive/blob/main/data/accept-language.yaml) | ~14 | A hand-picked subset of the above whose pages answer differently for `ja` vs `en`. The fixture for `--accept-language`. |
| [`data/js-redirect.yaml`](https://github.com/uraitakahito/browserhive/blob/main/data/js-redirect.yaml) | ~6 | URLs that navigate via JavaScript right after `DOMContentLoaded`. A regression fixture for `runOnStableContext` in [`src/capture/page-capturer.ts`](https://github.com/uraitakahito/browserhive/blob/main/src/capture/page-capturer.ts). |

Start with `smoke-test.yaml` and a `--limit`; reach for `nikkei225.yaml` when
you want the server under actual load.
