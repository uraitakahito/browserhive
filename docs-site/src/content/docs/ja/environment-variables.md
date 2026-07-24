---
title: 環境変数
description: CLI フラグ ↔ BROWSERHIVE_* 環境変数の完全な対応表(型・既定値つき)
---

すべての CLI フラグには `BROWSERHIVE_*` の環境変数版がある。解決順は **CLI フラグ > 環境変数 > 既定値**。

| CLI フラグ / 環境変数 | 型 / 形式 |
|---|---|
| `--port <port>`<code class="env">BROWSERHIVE_PORT</code> | 整数(1–65535) |
| `--browser-url <urls...>`<code class="env">BROWSERHIVE_BROWSER_URLS</code> | カンマ区切りリスト(必須) |
| `--s3-endpoint <url>`<code class="env">BROWSERHIVE_S3_ENDPOINT</code> | URL(必須) |
| `--s3-region <region>`<code class="env">BROWSERHIVE_S3_REGION</code> | 文字列(既定 `us-east-1`) |
| `--s3-bucket <name>`<code class="env">BROWSERHIVE_S3_BUCKET</code> | 文字列(必須) |
| `--s3-access-key-id <id>`<code class="env">BROWSERHIVE_S3_ACCESS_KEY_ID</code> | 文字列(必須。`ps` への漏洩を避けるため env 推奨) |
| `--s3-secret-access-key <secret>`<code class="env">BROWSERHIVE_S3_SECRET_ACCESS_KEY</code> | 文字列(必須。`ps` への漏洩を避けるため env 推奨) |
| `--s3-key-prefix <prefix>`<code class="env">BROWSERHIVE_S3_KEY_PREFIX</code> | 文字列(末尾スラッシュなし。既定は空) |
| `--s3-force-path-style`<code class="env">BROWSERHIVE_S3_FORCE_PATH_STYLE</code> | `"true"`/`"1"` または `"false"`/`"0"`(既定 `false` — AWS S3 向けの virtual-hosted-style。SeaweedFS / MinIO 等の自己ホスト S3 では有効化) |
| `--page-load-timeout <ms>`<code class="env">BROWSERHIVE_PAGE_LOAD_TIMEOUT_MS</code> | 正の整数 |
| `--capture-timeout <ms>`<code class="env">BROWSERHIVE_CAPTURE_TIMEOUT_MS</code> | 正の整数 |
| `--task-timeout <ms>`<code class="env">BROWSERHIVE_TASK_TIMEOUT_MS</code> | 正の整数(Layer B のタスク単位セーフティネット) |
| `--max-retry-count <n>`<code class="env">BROWSERHIVE_MAX_RETRY_COUNT</code> | 非負整数 |
| `--queue-poll-interval-ms <ms>`<code class="env">BROWSERHIVE_QUEUE_POLL_INTERVAL_MS</code> | 正の整数 |
| `--discovery-refresh-ms <ms>`<code class="env">BROWSERHIVE_DISCOVERY_REFRESH_MS</code> | ミリ秒の整数(既定 `10000`・最小 `1000`) — worker membership を DNS から再解決する間隔 |
| `--viewport-width <px>`<code class="env">BROWSERHIVE_VIEWPORT_WIDTH</code> | 正の整数(サーバ既定。リクエストの `viewport.width` が優先) |
| `--viewport-height <px>`<code class="env">BROWSERHIVE_VIEWPORT_HEIGHT</code> | 正の整数(サーバ既定。リクエストの `viewport.height` が優先) |
| `--screenshot-full-page`<code class="env">BROWSERHIVE_SCREENSHOT_FULL_PAGE</code> | `"true"`/`"1"` または `"false"`/`"0"`(サーバ既定。リクエストの `fullPage` が優先) |
| `--screenshot-quality <n>`<code class="env">BROWSERHIVE_SCREENSHOT_QUALITY</code> | 整数(1–100) |
| `--reject-duplicate-urls`<code class="env">BROWSERHIVE_REJECT_DUPLICATE_URLS</code> | `"true"`/`"1"` または `"false"`/`"0"` |
| `--no-reset-cookies`<code class="env">BROWSERHIVE_RESET_COOKIES</code> | `"true"`/`"1"` または `"false"`/`"0"`(タスク間 cookie 消去のサーバ既定。リクエストの `resetState.cookies` が優先) |
| `--no-reset-page-context`<code class="env">BROWSERHIVE_RESET_PAGE_CONTEXT</code> | `"true"`/`"1"` または `"false"`/`"0"`(タスク間 `about:blank` 遷移のサーバ既定。リクエストの `resetState.pageContext` が優先) |
| `--user-agent <string>`<code class="env">BROWSERHIVE_USER_AGENT</code> | 文字列 |
| `--wacz-max-response-bytes <n>`<code class="env">BROWSERHIVE_WACZ_MAX_RESPONSE_BYTES</code> | 正の整数(レスポンス単位の body 上限。既定 20 MB) |
| `--wacz-max-task-bytes <n>`<code class="env">BROWSERHIVE_WACZ_MAX_TASK_BYTES</code> | 正の整数(タスク累計の body 上限。既定 200 MB) |
| `--wacz-max-pending-requests <n>`<code class="env">BROWSERHIVE_WACZ_MAX_PENDING_REQUESTS</code> | 正の整数(in-flight 追跡数の上限。既定 5000) |
| `--wacz-block-pattern <patterns...>`<code class="env">BROWSERHIVE_WACZ_BLOCK_PATTERNS</code> | カンマ区切り glob(既定は同梱の analytics リスト) |
| `--wacz-skip-content-types <prefixes...>`<code class="env">BROWSERHIVE_WACZ_SKIP_CONTENT_TYPES</code> | カンマ区切り MIME 接頭辞(既定は空) |
| `--wacz-fuzzy-param <names...>`<code class="env">BROWSERHIVE_WACZ_FUZZY_PARAMS</code> | replay 時にキャッシュバスターとして扱うクエリパラメータ名(カンマ区切り) |
| `--tls-cert <path>`<code class="env">BROWSERHIVE_TLS_CERT</code> | パス |
| `--tls-key <path>`<code class="env">BROWSERHIVE_TLS_KEY</code> | パス |

`data-client` の例は 2 つの環境変数を受け付ける: `BROWSERHIVE_SERVER`(既定 `http://localhost:8080`)と `BROWSERHIVE_TLS_CA_CERT`(情報提供用。実際の CA ピン留めは `NODE_EXTRA_CA_CERTS` を使う)。ジョブ単位のフラグ(`--data`、`--png`、`--webp`、`--html`、`--links`、`--mhtml`、`--wacz`、`--limit`、`--dismiss-banners`、`--accept-language`、`--viewport-width`、`--viewport-height`、`--full-page`)には意図的に env 版が無い。
