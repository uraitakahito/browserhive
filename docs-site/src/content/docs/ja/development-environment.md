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
npm ci
npm run build
BROWSERHIVE_BROWSER_URLS=http://chromium-1.browserhive:9222 \
BROWSERHIVE_S3_ENDPOINT=http://seaweedfs.browserhive:8333 \
BROWSERHIVE_S3_BUCKET=browserhive \
BROWSERHIVE_S3_ACCESS_KEY_ID=browserhive \
BROWSERHIVE_S3_SECRET_ACCESS_KEY=browserhive \
BROWSERHIVE_S3_FORCE_PATH_STYLE=true \
LOG_LEVEL=info npm run server | pino-pretty
```

`npm ci` は `file:./meadow` の `prepare` により meadow もビルドします —
追加手順は不要です。

(ホストプロセスに 8080 を使いたい場合は、先にコンテナ版を
`container stop browserhive.browserhive` で止める。)

個別の設定は、別の環境変数を立てるか同等の CLI フラグを渡して都度上書きできる
(CLI > env > 既定)。全対応表は[環境変数](/environment-variables/)を参照。

CLI フラグは env 値より優先される。必要に応じて組み合わせる:

```sh
LOG_LEVEL=info npm run server -- \
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

例は TypeScript ソースのみで配布され、本番の `npm run build` は `src` + `bin`
だけをコンパイルする。`dist/examples/` も出す `build:examples` を使うこと。
実行先は起動中のサーバ(上のホスト開発ループ、またはコンテナスタック) —
既定では `localhost:8080` に投げる。

```sh
npm run build:examples
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

### 速すぎて見えないとき — `--slow-mo`

既定ではキャプチャが数秒で終わる(example.com で約 6 秒)ため、スクリーンキャストを
開くころには完了している。`--slow-mo` を付けて起動すると **puppeteer の各 CDP 操作の
間に遅延が入り**、1 手ずつ進む様子を追える:

```yaml
# docker-compose.yml の browserhive サービスに追加して再作成
environment:
  - BROWSERHIVE_SLOW_MO_MS=250
```

起動ログの `slowMo` フィールドで効いているか確認できる。実測(example.com、
PNG 1 枚):

| `slowMo` | 1 キャプチャの所要時間 |
|---|---|
| `0`(既定) | 約 6 秒 |
| `250` | 約 10 秒 |
| `1000` | 約 33 秒 |

- **接続時オプション**なので全 worker に効き、値の変更には browserhive の再作成が
  必要(リクエスト単位では切り替えられない)。
- 遅くなるのは **puppeteer の操作の間隔**であって、ページ自身の描画やスクロール
  速度ではない。スクロールをゆっくり見たいならリクエストの
  `behaviors.options.autoscroll.stepDelayMs` を上げる。
- 大きすぎる値は `--task-timeout`(既定 130 秒)に当たってタスクが失敗する。
  上の実測なら `1000` でも収まるが、重いページでは余裕が縮む。

## SeaweedFS 内の成果物を閲覧する

Filer UI は SeaweedFS コンテナで待ち受ける(ホストポートへの公開は無く、
DNS 名はこの Mac 内でのみ解決する):
`http://seaweedfs.browserhive:8888/buckets/browserhive/`。

SeaweedFS コンテナ内から:

```sh
container exec seaweedfs.browserhive sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```
