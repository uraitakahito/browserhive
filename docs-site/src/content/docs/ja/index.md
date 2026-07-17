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
      # /api/ は Starlight ロケール外(Redoc をデプロイ時に注入)。相対パスだと
      # Starlight が hero リンクに /ja を注入して 404 になるため絶対 URL で回避
      link: https://uraitakahito.github.io/browserhive/api/
      icon: external
      variant: minimal
---

## BrowserHive とは

BrowserHive は Fastify + Puppeteer で動く HTTP キャプチャサーバです。
`POST /v1/captures` を呼ぶとリクエストをキューに積むと、Chromium ワーカーが非同期で
ページを取得し、結果を S3 互換ストレージに保存します。

## 特長

- **Fire-and-forget**: リクエストは即座に受理(202)され、非同期に処理される
- **Capture coordinator**: 複数 worker が並行してキャプチャを処理(共有キューの work-stealing)
- **S3 互換の成果物ストレージ**: 全成果物を `s3://<bucket>/[<keyPrefix>/]<filename>` としてアップロード(SeaweedFS・AWS S3・Cloudflare R2 など)
- **リンク抽出**: オプションで `<a href>` を抽出し `…links.json` としてアップロード — 外部クロールドライバの発見側として設計
- **ステルスモード**: [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth) で Cloudflare WAF を含む bot 検出を回避
- **バナー / モーダル除去**: 既知の cookie 同意バナーや大きな fixed/sticky オーバーレイをキャプチャ前に除去するリクエスト単位フラグ(既定はベストエフォート。`failOnError: true` で厳格モード)
- **タスク間の状態分離**: cookie / `localStorage` / DOM コンテキストをタスク間で消去(サーバ単位・リクエスト単位で設定可能)
- **OpenAPI 3.1 契約**: [`src/http/openapi.yaml`](https://github.com/uraitakahito/browserhive/blob/main/src/http/openapi.yaml) が単一の真実 — リクエスト/レスポンス型と実行時検証の両方がここから導出される。[API リファレンス](/api/)参照

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
