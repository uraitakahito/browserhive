# Environment variables

Every CLI flag has a `BROWSERHIVE_*` env-var equivalent. Resolution order is **CLI flag > env var > default**.

| CLI flag | Environment variable | Type / format |
|---|---|---|
| `--port <port>` | `BROWSERHIVE_PORT` | integer (1–65535) |
| `--browser-url <urls...>` | `BROWSERHIVE_BROWSER_URLS` | comma-separated list (required) |
| `--s3-endpoint <url>` | `BROWSERHIVE_S3_ENDPOINT` | URL (required) |
| `--s3-region <region>` | `BROWSERHIVE_S3_REGION` | string (default `us-east-1`) |
| `--s3-bucket <name>` | `BROWSERHIVE_S3_BUCKET` | string (required) |
| `--s3-access-key-id <id>` | `BROWSERHIVE_S3_ACCESS_KEY_ID` | string (required; prefer env to avoid `ps` leak) |
| `--s3-secret-access-key <secret>` | `BROWSERHIVE_S3_SECRET_ACCESS_KEY` | string (required; prefer env to avoid `ps` leak) |
| `--s3-key-prefix <prefix>` | `BROWSERHIVE_S3_KEY_PREFIX` | string (no trailing slash; default empty) |
| `--s3-force-path-style` | `BROWSERHIVE_S3_FORCE_PATH_STYLE` | `"true"`/`"1"` or `"false"`/`"0"` (default `false` — virtual-hosted-style for AWS S3; opt in for SeaweedFS / MinIO / most self-hosted S3) |
| `--page-load-timeout <ms>` | `BROWSERHIVE_PAGE_LOAD_TIMEOUT_MS` | positive integer |
| `--capture-timeout <ms>` | `BROWSERHIVE_CAPTURE_TIMEOUT_MS` | positive integer |
| `--task-timeout <ms>` | `BROWSERHIVE_TASK_TIMEOUT_MS` | positive integer (Layer B per-task safety net) |
| `--max-retry-count <n>` | `BROWSERHIVE_MAX_RETRY_COUNT` | non-negative integer |
| `--queue-poll-interval-ms <ms>` | `BROWSERHIVE_QUEUE_POLL_INTERVAL_MS` | positive integer |
| `--viewport-width <px>` | `BROWSERHIVE_VIEWPORT_WIDTH` | positive integer (server-wide default; per-request `viewport.width` overrides) |
| `--viewport-height <px>` | `BROWSERHIVE_VIEWPORT_HEIGHT` | positive integer (server-wide default; per-request `viewport.height` overrides) |
| `--screenshot-full-page` | `BROWSERHIVE_SCREENSHOT_FULL_PAGE` | `"true"`/`"1"` or `"false"`/`"0"` (server-wide default; per-request `fullPage` overrides) |
| `--screenshot-quality <n>` | `BROWSERHIVE_SCREENSHOT_QUALITY` | integer (1–100) |
| `--reject-duplicate-urls` | `BROWSERHIVE_REJECT_DUPLICATE_URLS` | `"true"`/`"1"` or `"false"`/`"0"` |
| `--no-reset-cookies` | `BROWSERHIVE_RESET_COOKIES` | `"true"`/`"1"` or `"false"`/`"0"` (server-wide default for the inter-task cookie wipe; per-request `resetState.cookies` overrides) |
| `--no-reset-page-context` | `BROWSERHIVE_RESET_PAGE_CONTEXT` | `"true"`/`"1"` or `"false"`/`"0"` (server-wide default for the inter-task `about:blank` navigation; per-request `resetState.pageContext` overrides) |
| `--user-agent <string>` | `BROWSERHIVE_USER_AGENT` | string |
| `--wacz-max-response-bytes <n>` | `BROWSERHIVE_WACZ_MAX_RESPONSE_BYTES` | positive integer (per-response body cap; default 20 MB) |
| `--wacz-max-task-bytes <n>` | `BROWSERHIVE_WACZ_MAX_TASK_BYTES` | positive integer (per-task cumulative body cap; default 200 MB) |
| `--wacz-max-pending-requests <n>` | `BROWSERHIVE_WACZ_MAX_PENDING_REQUESTS` | positive integer (in-flight tracking cap; default 5000) |
| `--wacz-block-pattern <patterns...>` | `BROWSERHIVE_WACZ_BLOCK_PATTERNS` | comma-separated globs (default bundled analytics list) |
| `--wacz-skip-content-types <prefixes...>` | `BROWSERHIVE_WACZ_SKIP_CONTENT_TYPES` | comma-separated MIME prefixes (default empty) |
| `--wacz-fuzzy-param <names...>` | `BROWSERHIVE_WACZ_FUZZY_PARAMS` | comma-separated query param names treated as cache-busters at replay time |
| `--tls-cert <path>` | `BROWSERHIVE_TLS_CERT` | path |
| `--tls-key <path>` | `BROWSERHIVE_TLS_KEY` | path |

The `data-client` example accepts two env vars: `BROWSERHIVE_SERVER` (default `http://localhost:8080`) and `BROWSERHIVE_TLS_CA_CERT` (informational; for actual CA pinning use `NODE_EXTRA_CA_CERTS`). Per-job flags (`--data`, `--png`, `--webp`, `--html`, `--links`, `--pdf`, `--mhtml`, `--wacz`, `--limit`, `--dismiss-banners`, `--accept-language`, `--viewport-width`, `--viewport-height`, `--full-page`) intentionally have no env equivalents.
