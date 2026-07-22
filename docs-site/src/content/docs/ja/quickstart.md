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
- `curl` と `jq` コマンド

## Step 1 — リポジトリを取得する

```bash
git clone --recurse-submodules https://github.com/uraitakahito/browserhive.git
cd browserhive
```

## Step 2 — スタックを起動する

```bash
./bin/stack.sh up 2     # SeaweedFS + chromium worker×2 + BrowserHive
```

すべて Apple Container 上のコンテナ(軽量 VM)として起動します。
ホストに公開されるのは BrowserHive の 8080 だけで、worker と S3 は
固有 IP(192.168.64.0/24)への直結です。

| コンポーネント | アドレス | 用途 |
|----------------|----------|------|
| BrowserHive API | http://localhost:8080 | キャプチャ受付 |
| SeaweedFS S3 / Filer | `http://<seaweedfs-ip>:8333` / `:8888` | 成果物の保存先(IP は `container ls`) |
| chromium worker | `http://<worker-ip>:9222`(stack.sh up が表示) | CDP。目視は `chrome://inspect` |

起動確認:

```bash
./bin/stack.sh status
# または
curl -s http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["ready", "ready"] }
```

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
いちばん簡単なのは **Filer UI** をブラウザで開く方法です
(`<seaweedfs-ip>` は `container ls` で確認):

```text
http://<seaweedfs-ip>:8888/buckets/browserhive/
```

AWS CLI を使う場合(認証必須 — 既定クレデンシャルは browserhive/browserhive):

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://<seaweedfs-ip>:8333" \
  s3 ls s3://browserhive/

# WACZ をダウンロード (taskId は Step 3 のレスポンスから)
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://<seaweedfs-ip>:8333" \
  s3 cp s3://browserhive/550e8400-e29b-41d4-a716-446655440000.wacz ./capture.wacz
```

### WACZ を ReplayWeb.page で再生する

1. [replayweb.page](https://replayweb.page/) を開く
2. "Choose File" → `capture.wacz` を選択
3. ページ一覧が表示されたら URL をクリックして再生

## 片付け

```bash
./bin/stack.sh down     # 成果物は volume(seaweedfs-data)に残る
```

---

## 次のステップ

- [API リファレンス](/api/) — `dismissBanners` / `resetState` / `viewport` など全パラメータの型定義
- [アーキテクチャ解説](/architecture/) — XState ステートマシンと内部構造
- worker の動作確認・目視は chromium-server 側の
  [Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/) を参照
