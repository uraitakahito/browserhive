---
title: BrowserHive
description: URL を POST するだけで、スクリーンショット・HTML・WACZ アーカイブを S3 に保存する Web キャプチャサーバ
template: splash
hero:
  tagline: URL を POST するだけ。スクリーンショット・HTML・WACZ アーカイブを S3 に非同期保存
  actions:
    - text: クイックスタート
      link: /browserhive/quickstart/
      icon: right-arrow
      variant: primary
    - text: API リファレンス
      link: /browserhive/api/
      icon: external
      variant: minimal
---

## BrowserHive とは

BrowserHive は Fastify + Puppeteer で動く HTTP キャプチャサーバです。
`POST /v1/captures` を呼ぶとリクエストをキューに積み、202 を即座に返します。
Chromium ワーカーが非同期でページを取得し、結果を S3 互換ストレージに保存します。

```bash
curl -s -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","captureFormats":{"png":true,"webp":false,"html":false,"mhtml":false,"wacz":false,"links":false}}'
# → 202 {"taskId":"550e8400-...","status":"accepted"}
```

## 取得できる形式

| 形式 | フラグ | 用途 |
|------|--------|------|
| PNG スクリーンショット | `png: true` | ページ全体の画像 |
| WebP スクリーンショット | `webp: true` | 軽量な画像 |
| DOM スナップショット | `html: true` | JavaScript 実行後の HTML |
| 単一ファイルアーカイブ | `mhtml: true` | リソース埋め込み MHTML |
| 再生可能アーカイブ | `wacz: true` | WARC + インデックス (ReplayWeb.page で再生可) |
| リンク一覧 | `links: true` | ページ内リンクの JSON |

複数フラグを同時に `true` にすると 1 リクエストで複数形式を取得できます。

## さらに詳しく

- [クイックスタート](/quickstart/) — Docker 起動から最初のキャプチャまで 5 ステップ
- [アーキテクチャ解説](/architecture/) — XState ステートマシン・ワーカーモデルの詳細
- [API リファレンス](/api/) — 全パラメータの型定義と使用例
