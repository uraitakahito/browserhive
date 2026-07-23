---
title: クイックスタート
description: Apple Container でスタックを起動し、最初の WACZ キャプチャを取得するまでの 5 ステップ
sidebar:
  order: 1
---

5 ステップで BrowserHive を動かし、最初のキャプチャを取得します。

## 前提条件

- **macOS 26+ / Apple Silicon** と [Apple Container](https://github.com/apple/container)
  (`brew install container` → `container system start`)
- [container-compose](https://github.com/Mcrich23/Container-Compose)
  (`brew install container-compose`)
- 一度だけ: `sudo container system dns create browserhive` — スタックの
  `<service>.browserhive` 名をコンテナからもこの Mac からも解決可能にする
  ローカル DNS ドメインの登録
- `curl` と `jq` コマンド

## Step 1 — リポジトリを取得する

```bash
git clone --recurse-submodules https://github.com/uraitakahito/browserhive.git
cd browserhive
```

## Step 2 — スタックを起動する

```bash
container-compose up -d -b     # SeaweedFS + chromium worker + BrowserHive
```

すべて Apple Container 上のコンテナ(軽量 VM)として起動し、プラットフォーム
DNS 名で配線されます。ホストに公開されるのは BrowserHive の 8080 だけです。
既定は chromium worker 1 台 — `--profile scale2` / `--profile scale3` で
最大 3 台まで増やせます。

| コンポーネント | アドレス | 用途 |
|----------------|----------|------|
| BrowserHive API | http://localhost:8080 | キャプチャ受付 |
| SeaweedFS S3 / Filer | `http://seaweedfs.browserhive:8333` / `:8888` | 成果物の保存先 |
| chromium worker | `http://chromium-N.browserhive:9222` | CDP。目視は `chrome://inspect` |

起動を待ってから確認:

```bash
until curl -sf http://localhost:8080/v1/status >/dev/null; do sleep 1; done
curl -s http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": false, "workers": ["ready", "error", "error"] }
```

worker は常に 3 台分が宣言されます: 起動していない worker は `error` と表示され、
`isRunning` が `true` になるのは 3 台全部が `ready` のとき(`--profile scale3`)だけ。
`ready` が 1 台でもあれば capture は流れます。

## Step 3 — 最初のキャプチャをリクエストする

`POST /v1/captures` はリクエストを受け付けると **202** を即座に返します
(実際のキャプチャは非同期で実行されます)。

```bash
curl -s -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "captureFormats": {
      "png":   true,
      "webp":  false,
      "html":  false,
      "mhtml": false,
      "wacz":  true,
      "links": false
    }
  }' | jq .
```

レスポンス例:

```json
{
  "accepted": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`taskId` を手元に控えておきます。

## Step 4 — 処理状況を確認する

```bash
curl -s http://localhost:8080/v1/status | jq '{completed, workers: [.workers[] | {health, processedCount}]}'
```

`completed` が増え、worker の `processedCount` が上がっていればキャプチャ完了です。

## Step 5 — 成果物を取得する

成果物は SeaweedFS の `browserhive` バケットに保存されます。
いちばん簡単なのは **Filer UI** をブラウザで開く方法です:

```text
http://seaweedfs.browserhive:8888/buckets/browserhive/
```

AWS CLI を使う場合(認証必須 — 既定クレデンシャルは browserhive/browserhive):

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 ls s3://browserhive/

# WACZ をダウンロード (taskId は Step 3 のレスポンスから)
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-e29b-41d4-a716-446655440000.wacz ./capture.wacz
```

### WACZ を ReplayWeb.page で再生する

1. [replayweb.page](https://replayweb.page/) を開く
2. "Choose File" → `capture.wacz` を選択
3. ページ一覧が表示されたら URL をクリックして再生

## 片付け

```bash
container-compose down     # 成果物は volume(browserhive_seaweedfs-data)に残る
```

---

## 次のステップ

- [API リファレンス](/api/) — `dismissBanners` / `resetState` / `viewport` など全パラメータの型定義
- [アーキテクチャ解説](/architecture/) — XState ステートマシンと内部構造
- worker の動作確認・目視は chromium-server 側の
  [Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/) を参照
