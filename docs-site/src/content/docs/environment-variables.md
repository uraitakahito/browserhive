---
title: Environment variables
description: The full CLI flag ↔ BROWSERHIVE_* environment variable mapping, with types and defaults
---

Every CLI flag has a `BROWSERHIVE_*` env-var equivalent. Resolution order is **CLI flag > env var > default**.

| CLI flag / env var | Type / format |
|---|---|
| `--port <port>`<code class="env">BROWSERHIVE_PORT</code> | integer (1–65535) |
| `--browser-url <urls...>`<code class="env">BROWSERHIVE_BROWSER_URLS</code> | comma-separated list (required) |
| `--s3-endpoint <url>`<code class="env">BROWSERHIVE_S3_ENDPOINT</code> | URL (required) |
| `--s3-region <region>`<code class="env">BROWSERHIVE_S3_REGION</code> | string (default `us-east-1`) |
| `--s3-bucket <name>`<code class="env">BROWSERHIVE_S3_BUCKET</code> | string (required) |
| `--s3-access-key-id <id>`<code class="env">BROWSERHIVE_S3_ACCESS_KEY_ID</code> | string (required; prefer env to avoid `ps` leak) |
| `--s3-secret-access-key <secret>`<code class="env">BROWSERHIVE_S3_SECRET_ACCESS_KEY</code> | string (required; prefer env to avoid `ps` leak) |
| `--s3-key-prefix <prefix>`<code class="env">BROWSERHIVE_S3_KEY_PREFIX</code> | string (no trailing slash; default empty) |
| `--s3-force-path-style`<code class="env">BROWSERHIVE_S3_FORCE_PATH_STYLE</code> | `"true"`/`"1"` or `"false"`/`"0"` (default `false` — virtual-hosted-style for AWS S3; opt in for SeaweedFS / MinIO / most self-hosted S3) |
| `--page-load-timeout <ms>`<code class="env">BROWSERHIVE_PAGE_LOAD_TIMEOUT_MS</code> | positive integer |
| `--capture-timeout <ms>`<code class="env">BROWSERHIVE_CAPTURE_TIMEOUT_MS</code> | positive integer |
| `--task-timeout <ms>`<code class="env">BROWSERHIVE_TASK_TIMEOUT_MS</code> | positive integer (Layer B per-task safety net) |
| `--max-retry-count <n>`<code class="env">BROWSERHIVE_MAX_RETRY_COUNT</code> | non-negative integer |
| `--queue-poll-interval-ms <ms>`<code class="env">BROWSERHIVE_QUEUE_POLL_INTERVAL_MS</code> | positive integer |
| `--discovery-refresh-ms <ms>`<code class="env">BROWSERHIVE_DISCOVERY_REFRESH_MS</code> | integer ms (default `10000`, min `1000`) — how often worker membership is re-resolved from DNS |
| `--viewport-width <px>`<code class="env">BROWSERHIVE_VIEWPORT_WIDTH</code> | positive integer (server-wide default; per-request `viewport.width` overrides) |
| `--viewport-height <px>`<code class="env">BROWSERHIVE_VIEWPORT_HEIGHT</code> | positive integer (server-wide default; per-request `viewport.height` overrides) |
| `--screenshot-full-page`<code class="env">BROWSERHIVE_SCREENSHOT_FULL_PAGE</code> | `"true"`/`"1"` or `"false"`/`"0"` (server-wide default; per-request `fullPage` overrides) |
| `--screenshot-quality <n>`<code class="env">BROWSERHIVE_SCREENSHOT_QUALITY</code> | integer (1–100) |
| `--reject-duplicate-urls`<code class="env">BROWSERHIVE_REJECT_DUPLICATE_URLS</code> | `"true"`/`"1"` or `"false"`/`"0"` |
| `--no-reset-cookies`<code class="env">BROWSERHIVE_RESET_COOKIES</code> | `"true"`/`"1"` or `"false"`/`"0"` (server-wide default for the inter-task cookie wipe; per-request `resetState.cookies` overrides) |
| `--no-reset-page-context`<code class="env">BROWSERHIVE_RESET_PAGE_CONTEXT</code> | `"true"`/`"1"` or `"false"`/`"0"` (server-wide default for the inter-task `about:blank` navigation; per-request `resetState.pageContext` overrides) |
| `--user-agent <string>`<code class="env">BROWSERHIVE_USER_AGENT</code> | string |
| `--wacz-max-response-bytes <n>`<code class="env">BROWSERHIVE_WACZ_MAX_RESPONSE_BYTES</code> | positive integer (per-response body cap; default 20 MB) |
| `--wacz-max-task-bytes <n>`<code class="env">BROWSERHIVE_WACZ_MAX_TASK_BYTES</code> | positive integer (per-task cumulative body cap; default 200 MB) |
| `--wacz-max-pending-requests <n>`<code class="env">BROWSERHIVE_WACZ_MAX_PENDING_REQUESTS</code> | positive integer (in-flight tracking cap; default 5000) |
| `--wacz-block-pattern <patterns...>`<code class="env">BROWSERHIVE_WACZ_BLOCK_PATTERNS</code> | comma-separated globs (default bundled analytics list) |
| `--wacz-skip-content-types <prefixes...>`<code class="env">BROWSERHIVE_WACZ_SKIP_CONTENT_TYPES</code> | comma-separated MIME prefixes (default empty) |
| `--wacz-fuzzy-param <names...>`<code class="env">BROWSERHIVE_WACZ_FUZZY_PARAMS</code> | comma-separated query param names treated as cache-busters at replay time |
| `--tls-cert <path>`<code class="env">BROWSERHIVE_TLS_CERT</code> | path |
| `--tls-key <path>`<code class="env">BROWSERHIVE_TLS_KEY</code> | path |

The `data-client` example accepts two env vars: `BROWSERHIVE_SERVER` (default `http://localhost:8080`) and `BROWSERHIVE_TLS_CA_CERT` (informational; for actual CA pinning use `NODE_EXTRA_CA_CERTS`). Per-job flags (`--data`, `--png`, `--webp`, `--html`, `--links`, `--mhtml`, `--wacz`, `--limit`, `--dismiss-banners`, `--accept-language`, `--viewport-width`, `--viewport-height`, `--full-page`) intentionally have no env equivalents.
