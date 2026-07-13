# BrowserHive

A web-capture server: `POST` a URL and get screenshots, HTML, MHTML, link
lists, and replayable [WACZ](https://specs.webrecorder.net/wacz/1.1.1/)
archives stored in S3-compatible storage — captured asynchronously by a
pool of CDP-driven Chromium workers
([chromium-server-docker](https://github.com/uraitakahito/chromium-server-docker)).

## Documentation

Everything — quickstart, guides (development / production environments,
storage, TLS, environment variables), and internals (architecture, WACZ) —
lives on the docs site:

- **English** — <https://uraitakahito.github.io/browserhive/>
- **日本語** — <https://uraitakahito.github.io/browserhive/ja/>

The API reference (Redoc) is at <https://uraitakahito.github.io/browserhive/api/>.

## Related Projects

- [waggle](https://github.com/uraitakahito/waggle) — reads URLs from Postgres and drives BrowserHive.
- [chromium-server-docker](https://github.com/uraitakahito/chromium-server-docker) — the Chromium backend (git submodule).
