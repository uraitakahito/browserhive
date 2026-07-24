---
title: 環境変数
description: CLI フラグ ↔ BROWSERHIVE_* 環境変数の完全な対応表(型・既定値つき)
---

すべての CLI フラグには `BROWSERHIVE_*` の環境変数版がある。解決順は **CLI フラグ > 環境変数 > 既定値**。

| CLI フラグ | 環境変数 | 型 / 形式 |
|---|---|---|
| `--port <port>` | `BROWSERHIVE_PORT` | 整数(1–65535) |
| `--browser-url <urls...>` | `BROWSERHIVE_BROWSER_URLS` | カンマ区切りリスト(必須) |
| `--s3-endpoint <url>` | `BROWSERHIVE_S3_ENDPOINT` | URL(必須) |
| `--s3-region <region>` | `BROWSERHIVE_S3_REGION` | 文字列(既定 `us-east-1`) |
| `--s3-bucket <name>` | `BROWSERHIVE_S3_BUCKET` | 文字列(必須) |
| `--s3-access-key-id <id>` | `BROWSERHIVE_S3_ACCESS_KEY_ID` | 文字列(必須。`ps` への漏洩を避けるため env 推奨) |
| `--s3-secret-access-key <secret>` | `BROWSERHIVE_S3_SECRET_ACCESS_KEY` | 文字列(必須。`ps` への漏洩を避けるため env 推奨) |
| `--s3-key-prefix <prefix>` | `BROWSERHIVE_S3_KEY_PREFIX` | 文字列(末尾スラッシュなし。既定は空) |
| `--s3-force-path-style` | `BROWSERHIVE_S3_FORCE_PATH_STYLE` | `"true"`/`"1"` または `"false"`/`"0"`(既定 `false` — AWS S3 向けの virtual-hosted-style。SeaweedFS / MinIO 等の自己ホスト S3 では有効化) |
| `--page-load-timeout <ms>` | `BROWSERHIVE_PAGE_LOAD_TIMEOUT_MS` | 正の整数 |
| `--capture-timeout <ms>` | `BROWSERHIVE_CAPTURE_TIMEOUT_MS` | 正の整数 |
| `--task-timeout <ms>` | `BROWSERHIVE_TASK_TIMEOUT_MS` | 正の整数(Layer B のタスク単位セーフティネット) |
| `--max-retry-count <n>` | `BROWSERHIVE_MAX_RETRY_COUNT` | 非負整数 |
| `--queue-poll-interval-ms <ms>` | `BROWSERHIVE_QUEUE_POLL_INTERVAL_MS` | 正の整数 |
| `--discovery-refresh-ms <ms>` | `BROWSERHIVE_DISCOVERY_REFRESH_MS` | ミリ秒の整数(既定 `10000`・最小 `1000`) — worker membership を DNS から再解決する間隔 |
| `--viewport-width <px>` | `BROWSERHIVE_VIEWPORT_WIDTH` | 正の整数(サーバ既定。リクエストの `viewport.width` が優先) |
| `--viewport-height <px>` | `BROWSERHIVE_VIEWPORT_HEIGHT` | 正の整数(サーバ既定。リクエストの `viewport.height` が優先) |
| `--screenshot-full-page` | `BROWSERHIVE_SCREENSHOT_FULL_PAGE` | `"true"`/`"1"` または `"false"`/`"0"`(サーバ既定。リクエストの `fullPage` が優先) |
| `--screenshot-quality <n>` | `BROWSERHIVE_SCREENSHOT_QUALITY` | 整数(1–100) |
| `--reject-duplicate-urls` | `BROWSERHIVE_REJECT_DUPLICATE_URLS` | `"true"`/`"1"` または `"false"`/`"0"` |
| `--no-reset-cookies` | `BROWSERHIVE_RESET_COOKIES` | `"true"`/`"1"` または `"false"`/`"0"`(タスク間 cookie 消去のサーバ既定。リクエストの `resetState.cookies` が優先) |
| `--no-reset-page-context` | `BROWSERHIVE_RESET_PAGE_CONTEXT` | `"true"`/`"1"` または `"false"`/`"0"`(タスク間 `about:blank` 遷移のサーバ既定。リクエストの `resetState.pageContext` が優先) |
| `--user-agent <string>` | `BROWSERHIVE_USER_AGENT` | 文字列 |
| `--wacz-max-response-bytes <n>` | `BROWSERHIVE_WACZ_MAX_RESPONSE_BYTES` | 正の整数(レスポンス単位の body 上限。既定 20 MB) |
| `--wacz-max-task-bytes <n>` | `BROWSERHIVE_WACZ_MAX_TASK_BYTES` | 正の整数(タスク累計の body 上限。既定 200 MB) |
| `--wacz-max-pending-requests <n>` | `BROWSERHIVE_WACZ_MAX_PENDING_REQUESTS` | 正の整数(in-flight 追跡数の上限。既定 5000) |
| `--wacz-block-pattern <patterns...>` | `BROWSERHIVE_WACZ_BLOCK_PATTERNS` | カンマ区切り glob(既定は同梱の analytics リスト) |
| `--wacz-skip-content-types <prefixes...>` | `BROWSERHIVE_WACZ_SKIP_CONTENT_TYPES` | カンマ区切り MIME 接頭辞(既定は空) |
| `--wacz-fuzzy-param <names...>` | `BROWSERHIVE_WACZ_FUZZY_PARAMS` | replay 時にキャッシュバスターとして扱うクエリパラメータ名(カンマ区切り) |
| `--tls-cert <path>` | `BROWSERHIVE_TLS_CERT` | パス |
| `--tls-key <path>` | `BROWSERHIVE_TLS_KEY` | パス |

`data-client` の例は 2 つの環境変数を受け付ける: `BROWSERHIVE_SERVER`(既定 `http://localhost:8080`)と `BROWSERHIVE_TLS_CA_CERT`(情報提供用。実際の CA ピン留めは `NODE_EXTRA_CA_CERTS` を使う)。ジョブ単位のフラグ(`--data`、`--png`、`--webp`、`--html`、`--links`、`--mhtml`、`--wacz`、`--limit`、`--dismiss-banners`、`--accept-language`、`--viewport-width`、`--viewport-height`、`--full-page`)には意図的に env 版が無い。
