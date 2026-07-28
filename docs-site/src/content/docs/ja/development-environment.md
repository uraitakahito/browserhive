---
title: 開発環境
description: Apple Container スタックに対するホスト側開発 — 開発ループ・worker の観察・成果物の閲覧
---

スタック(SeaweedFS + chromium worker + サーバ)は
[Apple Container](https://github.com/apple/container) 上で動かし、
編集対象のサーバコードは**ホスト側**で動かす。dev コンテナは無い。

## フルスタック(動く BrowserHive が欲しいだけのとき)

```sh
container-compose up -d -b                   # SeaweedFS + worker 1 台 + browserhive:prod
container-compose --profile scale3 up -d -b  # …worker 3 台で立てる場合
container-compose down                       # 停止(up と同じ --profile を渡すこと。
                                             #  成果物は volume に残る)

# readiness の確認は利用側の仕事(compose は待たない):
until curl -sf http://localhost:8080/v1/status >/dev/null; do sleep 1; done
```

## ホスト開発ループ(サーバを変更しているとき)

スタックを一度立てたら、開発中のサーバをホストで動かし、同じ worker と S3 に
向ける。プラットフォーム DNS 名はホストからも解決できるため、配線は静的に書ける:

```sh
pnpm install --frozen-lockfile
pnpm run build
BROWSERHIVE_BROWSER_URLS=http://chromium-1.browserhive:9222 \
BROWSERHIVE_S3_ENDPOINT=http://seaweedfs.browserhive:8333 \
BROWSERHIVE_S3_BUCKET=browserhive \
BROWSERHIVE_S3_ACCESS_KEY_ID=browserhive \
BROWSERHIVE_S3_SECRET_ACCESS_KEY=browserhive \
BROWSERHIVE_S3_FORCE_PATH_STYLE=true \
LOG_LEVEL=info pnpm run server | pino-pretty
```

`meadow` は workspace メンバーなので、install は link するだけです。dist/ は
E2E が必要とする時点で `pnpm run test:e2e` がビルドします。先に作りたい場合は
`pnpm --filter meadow build` を実行してください。

(ホストプロセスに 8080 を使いたい場合は、先にコンテナ版を
`container stop browserhive.browserhive` で止める。)

個別の設定は、別の環境変数を立てるか同等の CLI フラグを渡して都度上書きできる
(CLI > env > 既定)。全対応表は[環境変数](/environment-variables/)を参照。

CLI フラグは env 値より優先される。必要に応じて組み合わせる:

```sh
LOG_LEVEL=info pnpm run server -- \
  --reject-duplicate-urls \
  --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36" \
  | pino-pretty
```

## 例: data client

YAML データファイルからキャプチャリクエストを送る例クライアント
(fire-and-forget)。形式とパーサは
[`examples/data-file.ts`](https://github.com/uraitakahito/browserhive/blob/main/examples/data-file.ts)
にある。クライアントは受理確認を受け取るだけで、実際のキャプチャはサーバが
非同期に処理する — 完了はサーバログで確認する。

例は TypeScript ソースのみで配布され、本番の `pnpm run build` は `src` + `bin`
だけをコンパイルする。`dist/examples/` も出す `build:examples` を使うこと。
実行先は起動中のサーバ(上のホスト開発ループ、またはコンテナスタック) —
既定では `localhost:8080` に投げる。

```sh
pnpm run build:examples
node dist/examples/data-client.js \
  --data data/smoke-test.yaml --webp --html --links --limit 30 \
  --accept-language "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" \
  | pino-pretty
```

## Chromium の描画を観察する

worker は headless。DevTools のスクリーンキャストで観察する:
ホストの Chrome で `chrome://inspect/#devices` を開き、**Configure…** に
`<worker-ip>:9222` を登録して **inspect** をクリック — headless のまま
ページがライブ描画される。手順の詳細(ポート誤りの罠を含む)は
chromium-server 側のドキュメント
[Verifying workers](https://uraitakahito.github.io/chromium-server-docker/ja/getting-started/verify/)
を参照。ワンショットの CDP 確認は `./chromium-server-docker/bin/cdp.sh smoke`。

### 速すぎて見えないとき — `operationDelayMs`

既定ではキャプチャが数秒で終わる(example.com で約 6 秒)ため、スクリーンキャストを
開くころには完了している。リクエストに `operationDelayMs` を付けると
**各ブラウザ操作の前に遅延が入り**、1 手ずつ進む様子を追える:

```bash
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.example.com/",
    "operationDelayMs": 250,
    "captureFormats": {
      "png": true, "webp": false, "html": false,
      "links": false, "mhtml": false, "wacz": false
    }
  }' | jq .
```

**そのリクエストにだけ**効く(ブラウザ接続は張り替えないので、他のキャプチャは
速いまま)。実測(example.com、PNG 1 枚):

| `operationDelayMs` | 1 キャプチャの所要時間 |
|---|---|
| 省略(既定 `0`) | 約 6 秒 |
| `250` | 約 10 秒 |
| `1000` | 約 19 秒 |

- 全リクエストを遅くしたいときは、サーバ既定を
  `--operation-delay-ms` / `BROWSERHIVE_OPERATION_DELAY_MS` で設定する
  (リクエストの値が優先)。
- 遅くなるのは **BrowserHive が出すブラウザ操作の間隔**であって、ページ自身の
  描画やスクロール速度ではない。スクロールをゆっくり見たいならリクエストの
  `behaviors.options.autoscroll.stepDelayMs` を上げる。
- 大きすぎる値は `--task-timeout`(既定 130 秒)に当たってタスクが失敗する。

## SeaweedFS 内の成果物を閲覧する

Filer UI は SeaweedFS コンテナで待ち受ける(ホストポートへの公開は無く、
DNS 名はこの Mac 内でのみ解決する):
`http://seaweedfs.browserhive:8888/buckets/browserhive/`。

SeaweedFS コンテナ内から:

```sh
container exec seaweedfs.browserhive sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```
