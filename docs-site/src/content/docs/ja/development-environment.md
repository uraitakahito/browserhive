---
title: 開発環境
description: Apple Container スタックに対するホスト側開発 — 開発ループ・worker の観察・成果物の閲覧
---

スタック(SeaweedFS + chromium worker + サーバ)は
[Apple Container](https://github.com/apple/container) 上で動かし、
編集対象のサーバコードは**ホスト側**で動かす。dev コンテナは無い。

このページはサーバを動かして観察することについて。そのサーバに対してテストを
走らせる方法 — 2 つの Vitest プロジェクト、E2E が必要とするもの、`@vitest/ui` の
レポート — は[テストの実行](/running-tests/)にある。

## フルスタック(動く BrowserHive が欲しいだけのとき)

```sh title="SeaweedFS + worker 1 台 + browserhive:prod"
container-compose up -d -b
```

```sh title="…worker 3 台で立てる場合"
container-compose --profile scale3 up -d -b
```

```sh title="停止 — up と同じ --profile を渡すこと。成果物は volume に残る"
container-compose down
```

```sh title="readiness の確認は利用側の仕事 — compose は待たない"
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

## サーバを手で叩く

動かしているサーバ — コンテナスタックか、上のホストループ — にサンプル
クライアントを向ける:

```sh
pnpm run build:examples
node dist/examples/data-client.js \
  --data data/smoke-test.yaml --webp --html --links --limit 30 \
  | pino-pretty
```

フラグ・読み込む YAML の形式・`data/` のフィクスチャは[examples](/examples/)にある。

## Chromium の描画を観察する

worker は headless。DevTools のスクリーンキャストで観察する:
ホストの Chrome で `chrome://inspect/#devices` を開き、**Configure…** に
`<worker-ip>:9222` を登録して **inspect** をクリック — headless のまま
ページがライブ描画される。手順の詳細(ポート誤りの罠を含む)は
chromium-server 側のドキュメント
[Verifying workers](https://uraitakahito.github.io/chromium-server-docker/ja/getting-started/verify/)
を参照。ワンショットの CDP 確認は `./chromium-server-docker/bin/cdp.sh smoke`。

### 速すぎて見えないとき — `operationDelayMs`

軽いページならキャプチャは数秒で終わるので、スクリーンキャストを開くころには
完了している。リクエストに `operationDelayMs` を付けると
**各ブラウザ操作の前に遅延が入り**、1 手ずつ進む様子を追える:

```bash
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.yahoo.co.jp/",
    "operationDelayMs": 250,
    "captureFormats": {
      "png": true, "webp": false, "html": false,
      "links": false, "mhtml": false, "wacz": false
    }
  }' | jq .
```

**そのリクエストにだけ**効く(ブラウザ接続は張り替えないので、他のキャプチャは
速いまま)。実測(`www.yahoo.co.jp`、PNG 1 枚):

| `operationDelayMs` | 1 キャプチャの所要時間 |
|---|---|
| 省略(既定 `0`) | 約 30 秒 |
| `250` | 約 33 秒 |
| `1000` | 約 41 秒 |

- 全リクエストを遅くしたいときは、サーバ既定を
  `--operation-delay-ms` / `BROWSERHIVE_OPERATION_DELAY_MS` で設定する
  (リクエストの値が優先)。
- 遅くなるのは **BrowserHive が出すブラウザ操作の間隔**であって、ページ自身の
  描画やスクロール速度ではない。だから上の合計は遅延の見た目ほど伸びない —
  これだけ重いページでは読み込み自体が支配的になる。スクロールをゆっくり見たい
  ならリクエストの `behaviors.options.autoscroll.stepDelayMs` を上げる。
- 上限を決めているのはタスク全体の予算だけ。1 キャプチャが出す paced な操作は
  約 12 回なので、1 回あたり 10 秒程度までが `--task-timeout`(既定 130 秒)に
  収まる。それを超えれば「時間がかかりすぎ」として失敗するのが正しい。
  1 操作あたりの予算はこの待ちを勘定に入れない — 予算が測るのは操作であって、
  その手前の休憩ではない。(以前は勘定に入れており、2 秒以上の遅延を指定すると
  キャプチャが必ず失敗していた。)
- 遅くするだけでは、何を**している**のかは分からない。リクエストに
  `"trace": true` を付けると、BrowserHive が何をしたか — ページへの介入、
  behavior が下した判断、アーカイブに入らなかった応答 — が同じ DevTools の
  console に出る。[Behavior](/behaviors/#キャプチャをライブで読む)を参照。

## SeaweedFS 内の成果物を閲覧する

Filer UI は SeaweedFS コンテナで待ち受ける(ホストポートへの公開は無く、
DNS 名はこの Mac 内でのみ解決する):
`http://seaweedfs.browserhive:8888/buckets/browserhive/`。

SeaweedFS コンテナ内から:

```sh
container exec seaweedfs.browserhive sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```
