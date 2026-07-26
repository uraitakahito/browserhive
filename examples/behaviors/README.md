# Custom behaviors (example client)

Client-supplied **custom behaviors** that the example client
(`examples/data-client.ts`) attaches to a capture request based on the target
URL's host. The server runs them alongside the built-ins (`autoscroll`,
`autofetch`, …) and only honours them when started with
`--allow-custom-behaviors`.

## Layout

```
examples/behaviors/
└─ <version>/                 # behaviors runtime-contract version (e.g. v1.0)
   ├─ <FQDN|domain>/          # one directory per site
   │  └─ <name>.js            # a bare class expression (see below)
   └─ README.md               # what lives in this version
```

- **`<version>`** — the runtime **contract** version (`ctx.Lib` API + the
  `static id` / `isMatch` / `async *run` shape). Bump to `v1.1` / `v2.0` on a
  breaking contract change; older behaviors keep working under their own
  version directory. The example client selects it with
  `--behaviors-version` (default `v1.0`).
- **`<FQDN|domain>`** — the directory name is the site's **FQDN**
  (e.g. `www.apple.com`) or its **registrable domain** (e.g. `apple.com`, to
  cover every subdomain). For a capture the client loads, in order, the FQDN
  directory then the registrable-domain directory.

## Behavior file contract

Each `<name>.js` is a **bare JavaScript class expression** (not a module — no
`export`, no name), injected as `register(<file contents>)`:

```js
class {
  static id = "www.apple.com:tv-gallery";   // MUST equal "<dir>:<basename>"
  static isMatch() { return location.hostname === "www.apple.com"; }
  async *run(ctx) {
    // ctx.Lib.{sleep,collectCandidateUrls,collectStyleSheetUrls,scrollIntoView}
    // ctx.opts (per-behavior options), ctx.getState(msg, counter)
    yield ctx.getState("step", "n");
  }
}
```

- **`static id` must equal `"<dir>:<basename>"`** — the client puts that id in
  the request, and the runner only runs an enabled id when a registered class
  has the same `static id`. For `www.apple.com/tv-gallery.js` the id is
  `www.apple.com:tv-gallery`.
- These files reference DOM globals and run in the page, so they are **excluded
  from tsc and ESLint** (they are text templates, not compiled modules).

## Verifying a run

Start the server with `--allow-custom-behaviors`, submit with the example
client, and check the completed-task log's `behaviorReport`:

```jsonc
"behaviorReport": { "ran": [ { "id": "www.apple.com:tv-gallery", "steps": 6 } ] }
```
