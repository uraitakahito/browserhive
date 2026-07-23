---
title: ストレージ
description: S3 互換の成果物ストア — 同梱 SeaweedFS・外部 S3・アドレッシング方式
---

キャプチャ成果物(PNG / WebP / HTML / links JSON / MHTML / WACZ)は
`@aws-sdk/client-s3` 経由で S3 互換オブジェクトストアへアップロードされる。
S3 API を話すものなら何でも使える — 自己ホストの SeaweedFS(同梱の既定)、
AWS S3、Cloudflare R2、MinIO 互換のマネージドサービス。

## 同梱 SeaweedFS

compose スタック(`docker-compose.yml`)は自己ホストの SeaweedFS サービス
(Apache 2.0・活発にメンテ)を同梱し、その entrypoint が初回起動時に
`browserhive` bucket を上限つきリトライで作成する。
既定の S3 identity は `browserhive` / `browserhive` で、`docker-compose.yml` の
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY` env で
設定される(SeaweedFS と BrowserHive の両サービスが同じペアを持つため、
両者の資格情報は構成上必ず一致する)。

ホストへのポート公開は無い: S3 API(`:8333`)と Filer UI(`:8888`)は
SeaweedFS コンテナで待ち受け、この Mac からはプラットフォーム DNS 名で到達する
(成果物の閲覧は `http://seaweedfs.browserhive:8888/buckets/browserhive/`)。

## 外部 S3

外部ストア(AWS / R2 / MinIO 互換のマネージドサービス)へ向けるには、
BrowserHive コンテナの `BROWSERHIVE_S3_*` 環境変数を設定する:

```yaml
environment:
  - BROWSERHIVE_S3_ENDPOINT=https://s3.example.com
  - BROWSERHIVE_S3_BUCKET=browserhive-prod
  - BROWSERHIVE_S3_REGION=us-east-1
  - BROWSERHIVE_S3_ACCESS_KEY_ID=...
  - BROWSERHIVE_S3_SECRET_ACCESS_KEY=...
```

既定は virtual-hosted-style アドレッシング — AWS S3 が期待する形式。
SeaweedFS・MinIO 互換のマネージドサービス・その他ほとんどの自己ホスト S3
実装(bucket サブドメインのワイルドカード DNS を持たない)では
`--s3-force-path-style`(または `BROWSERHIVE_S3_FORCE_PATH_STYLE=true`)を
指定する。`docker-compose.yml` は同梱 SeaweedFS に対しこの env 変数で
path-style を有効化している。

`s3-access-key-id` と `s3-secret-access-key` はコマンドラインでも受け付けるが、
`ps` 経由の漏洩を避けるため `BROWSERHIVE_S3_ACCESS_KEY_ID` /
`BROWSERHIVE_S3_SECRET_ACCESS_KEY` の環境変数を推奨する。
