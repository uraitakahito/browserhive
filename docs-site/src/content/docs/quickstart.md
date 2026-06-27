---
title: クイックスタート
description: Docker 起動から最初の WACZ キャプチャまで 5 ステップ
sidebar:
  order: 1
---

5 ステップで BrowserHive を動かし、最初のキャプチャを取得します。

## 前提条件

- Docker Engine 24+ / Docker Desktop
- Docker Compose v2+
- `curl` と `jq` コマンド

## Step 1 — リポジトリを取得する

```bash
git clone https://github.com/uraitakahito/browserhive.git
cd browserhive
```

## Step 2 — 環境を起動する

```bash
docker compose -f compose.dev.yaml up -d
```

起動後に立ち上がるサービスは以下の通りです。

| サービス | アドレス | 用途 |
|----------|----------|------|
| BrowserHive API | http://localhost:8080 | キャプチャ受付 |
| SeaweedFS S3 | http://localhost:8333 | 成果物の保存先 |
| Chromium (noVNC) | http://localhost:6080 | ブラウザの確認 |

起動確認:

```bash
curl -s http://localhost:8080/v1/status | jq '.coordinator.state'
# → "active.running"
```

`active.running` が返れば準備完了です。

## Step 3 — 最初のキャプチャをリクエストする

`POST /v1/captures` はリクエストを受け付けると **202** を即座に返します
(火打ち石モデル: 実際のキャプチャは非同期で実行されます)。

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
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted"
}
```

`taskId` を手元に控えておきます。

## Step 4 — 処理状況を確認する

```bash
curl -s http://localhost:8080/v1/status | jq '.coordinator.workers'
```

ワーカーの `state` が `"operational.idle"` になっていればキャプチャ完了です。
処理中は `"operational.processing"` が表示されます。

## Step 5 — 成果物を取得する

デフォルトでは SeaweedFS の `browserhive` バケットに保存されます。

```bash
# バケット内のファイルを一覧
aws --endpoint-url http://localhost:8333 \
  --no-sign-request \
  s3 ls s3://browserhive/

# WACZ をダウンロード (taskId は Step 3 のレスポンスから)
aws --endpoint-url http://localhost:8333 \
  --no-sign-request \
  s3 cp s3://browserhive/550e8400-e29b-41d4-a716-446655440000.wacz ./capture.wacz
```

### WACZ を ReplayWeb.page で再生する

1. [replayweb.page](https://replayweb.page/) を開く
2. "Choose File" → `capture.wacz` を選択
3. ページ一覧が表示されたら URL をクリックして再生

---

## 次のステップ

- [API リファレンス](/api/) — `dismissBanners` / `resetState` / `viewport` など全パラメータの型定義
- [アーキテクチャ解説](/architecture/) — XState ステートマシンと内部構造
