---
title: ストレージ
description: S3 互換の成果物ストア — 同梱 SeaweedFS・外部 S3・アドレッシング方式
---

キャプチャ成果物(PNG / WebP / HTML / links JSON / MHTML / WACZ)は
`@aws-sdk/client-s3` 経由で S3 互換オブジェクトストアへアップロードされる。
S3 API を話すものなら何でも使える — 自己ホストの SeaweedFS(同梱の既定)、
AWS S3、Cloudflare R2、MinIO 互換のマネージドサービス。

## 同梱 SeaweedFS

`bin/up.sh` は自己ホストの SeaweedFS サービス(Apache 2.0・活発にメンテ)と、
初回起動時に `browserhive` bucket を作る one-shot の `weed shell` 初期化を同梱する。
既定の S3 identity は `browserhive` / `browserhive` で、`./bin/up.sh` 実行時の
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY` 環境変数で
上書きできる(同梱 SeaweedFS と BrowserHive コンテナは同じペアを読むため、
両者の資格情報は構成上必ず一致する)。

ホストへのポート公開は無い: S3 API(`:8333`)と Filer UI(`:8888`)は
SeaweedFS コンテナ自身の IP で待ち受け、この Mac からのみ到達できる
(成果物の閲覧は `http://<seaweedfs-ip>:8888/buckets/browserhive/`。
IP は `container ls`)。

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
指定する。`bin/up.sh` は同梱 SeaweedFS に対しこの env 変数で自動的に
path-style を有効化する。

`s3-access-key-id` と `s3-secret-access-key` はコマンドラインでも受け付けるが、
`ps` 経由の漏洩を避けるため `BROWSERHIVE_S3_ACCESS_KEY_ID` /
`BROWSERHIVE_S3_SECRET_ACCESS_KEY` の環境変数を推奨する。
