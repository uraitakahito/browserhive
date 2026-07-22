---
title: 開発環境
description: Apple Container スタックに対するホスト側開発 — 開発ループ・worker の観察・成果物の閲覧と削除
---

スタック(SeaweedFS + chromium worker + サーバ)は
[Apple Container](https://github.com/apple/container) 上で動かし、
編集対象のサーバコードは**ホスト側**で動かす。dev コンテナは無い。

## フルスタック(動く BrowserHive が欲しいだけのとき)

```sh
./bin/stack.sh up 2        # SeaweedFS + worker×2 + browserhive:prod
./bin/stack.sh status      # 全コンポーネントの外部ヘルスプローブ
./bin/stack.sh down        # 全停止(成果物は volume に残る)
```

## ホスト開発ループ(サーバを変更しているとき)

スタックを一度立てたら、開発中のサーバをホストで動かし、同じ worker と S3 に
向ける。worker の URL は `./bin/stack.sh up` が表示する
(`http://192.168.64.x:9222,...`)。SeaweedFS のエンドポイントは
`http://<seaweedfs-ip>:8333`(IP は `container ls`)。

```sh
npm ci
npm run build
BROWSERHIVE_BROWSER_URLS=http://192.168.64.x:9222 \
BROWSERHIVE_S3_ENDPOINT=http://192.168.64.y:8333 \
BROWSERHIVE_S3_BUCKET=browserhive \
BROWSERHIVE_S3_ACCESS_KEY_ID=browserhive \
BROWSERHIVE_S3_SECRET_ACCESS_KEY=browserhive \
BROWSERHIVE_S3_FORCE_PATH_STYLE=true \
LOG_LEVEL=info npm run server | pino-pretty
```

`npm ci` は `file:./meadow` の `prepare` により meadow もビルドします —
追加手順は不要です。

(ホストプロセスに 8080 を使いたい場合は、先にコンテナ版を
`container stop browserhive` で止める。)

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

先にビルドする(例は TypeScript ソースのみで配布):

```sh
npm run build
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
[Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/)
を参照。ワンショットの CDP 確認は `./chromium-server-docker/bin/cdp.sh smoke`。

## SeaweedFS 内の成果物を閲覧する

Filer UI は SeaweedFS コンテナ自身の IP で待ち受ける(ホストへの公開は無い):
`http://<seaweedfs-ip>:8888/buckets/browserhive/`。

SeaweedFS コンテナ内から:

```sh
container exec browserhive-seaweedfs sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```

## 成果物を削除する

### 全成果物を消して bucket は残す(Filer HTTP API)

```sh
SW=<seaweedfs-ip>
curl -X DELETE "http://${SW}:8888/buckets/browserhive/?recursive=true&ignoreRecursiveError=true" && \
  curl -X PUT  "http://${SW}:8888/buckets/browserhive/.keep" --data '' && \
  curl -X DELETE "http://${SW}:8888/buckets/browserhive/.keep"
```

### SeaweedFS の状態ごとリセットする

```sh
./bin/stack.sh down
container volume rm seaweedfs-data
./bin/stack.sh up 2
```

`seaweedfs-data` volume を落とし、bucket と SeaweedFS のメタデータごと消す。
次回の `stack.sh up` が volume と bucket を作り直す。SeaweedFS の状態自体が怪しいとき
(メタデータ破損・資格情報の不一致)の手段であり、日常の成果物掃除には使わない。
