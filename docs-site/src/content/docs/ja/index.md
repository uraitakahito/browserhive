---
title: BrowserHive
description: URL を POST するだけで、スクリーンショット・HTML・WACZ アーカイブを S3 に保存する Web キャプチャサーバ
template: splash
hero:
  tagline: URL を POST するだけ。スクリーンショット・HTML・WACZ アーカイブを S3 に非同期保存
  actions:
    - text: クイックスタート
      # frontmatter は rehype を通らないため base + /ja を直書き
      link: /browserhive/ja/quickstart/
      icon: right-arrow
      variant: primary
    - text: API リファレンス
      # API リファレンスはロケール外(redocly 生成)なので /ja は付けない
      link: /browserhive/api/
      icon: external
      variant: minimal
---

## BrowserHive とは

BrowserHive は Fastify + Puppeteer で動く HTTP キャプチャサーバです。
`POST /v1/captures` を呼ぶとリクエストをキューに積み、202 を即座に返します。
Chromium ワーカーが非同期でページを取得し、結果を S3 互換ストレージに保存します。

## 取得できる形式

| 形式 | フラグ | 用途 |
|------|--------|------|
| PNG スクリーンショット | `png` | ページ全体の画像 |
| WebP スクリーンショット | `webp` | 軽量な画像 |
| DOM スナップショット | `html` | JavaScript 実行後の HTML |
| 単一ファイルアーカイブ | `mhtml` | リソース埋め込み MHTML |
| 再生可能アーカイブ | `wacz` | WARC + インデックス (ReplayWeb.page で再生可) |
| リンク一覧 | `links` | ページ内リンクの JSON |

## さらに詳しく

- [クイックスタート](/quickstart/) — Apple Container 起動から最初のキャプチャまで 5 ステップ
- [アーキテクチャ解説](/architecture/) — XState ステートマシン・ワーカーモデルの詳細
- [API リファレンス](/api/) — 全パラメータの型定義と使用例
