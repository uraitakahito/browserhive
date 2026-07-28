---
title: ストレージ
description: S3 互換の成果物ストア — 同梱 SeaweedFS・成果物の削除・外部 S3・アドレッシング方式
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

## 成果物を削除する

同梱 SeaweedFS 上の成果物を消す方法。初回は成果物が無いので、掃除が要るときだけ使う。

### 全成果物を消して bucket は残す(Filer HTTP API)

```sh
SW=seaweedfs.browserhive
curl -X DELETE "http://${SW}:8888/buckets/browserhive/?recursive=true&ignoreRecursiveError=true" && \
  curl -X PUT  "http://${SW}:8888/buckets/browserhive/.keep" --data '' && \
  curl -X DELETE "http://${SW}:8888/buckets/browserhive/.keep"
```

### SeaweedFS の状態ごとリセットする

```sh
container-compose down
container volume rm browserhive_seaweedfs-data
container-compose up -d
```

`browserhive_seaweedfs-data` volume を落とし、bucket と SeaweedFS のメタデータごと
消す。次回の `up` が volume を、seaweedfs の entrypoint が bucket を作り直す。
SeaweedFS の状態自体が怪しいとき
(メタデータ破損・資格情報の不一致)の手段であり、日常の成果物掃除には使わない。

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

### region は何に使われるのか

`BROWSERHIVE_S3_REGION` は接続先を決めるものではない。接続先を決めるのは
`BROWSERHIVE_S3_ENDPOINT` である。region は、署名付きリクエストが必ず運ぶ
SigV4 の credential scope の 1 フィールドとして載る。

```
Credential=browserhive/20260728/us-east-1/s3/aws4_request
            └ access key ┘ └ 日付 ┘ └ region ┘ └ service ┘
```

**同梱 SeaweedFS はこの値を検証しない。** `moon-base-1` で署名しても成功し、
bucket の一覧もまったく同じように取れる。既定の `us-east-1` は場所ではなく
プレースホルダである。

とはいえ省略はできない。署名を作る側は必ず何らかの region を要求し、
無かった場合の挙動がクライアントによって食い違う — AWS CLI は黙って
`us-east-1` に落とすが、同じオブジェクトを読む
[waxlens](https://github.com/uraitakahito/waxlens) が使う AWS SDK for
JavaScript は `Region is missing` で失敗する。明示しておけば両方揃う。

:::caution[`~/.aws/config` から来ているかもしれない]
SDK は `~/.aws/config` の `region` も読むため、profile を設定してある
マシンでは環境変数を何も設定しなくても動いてしまう。破綻するのは、その
ファイルが無いマシン — CI ランナーやコンテナ — に持って行ったときである。
周囲の profile に頼らず明示すること。
:::

本物の AWS に向ける場合、region はプレースホルダではなくなる。bucket の
region と一致している必要があり、endpoint を上書きしなければ接続先ホスト名
(`s3.<region>.amazonaws.com`) の決定にも使われる。「どんな文字列でも通る」の
は、endpoint を S3 互換ストアに固定している間だけの話である。
