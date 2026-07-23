---
title: 本番環境
description: container-compose でフルスタック(SeaweedFS + chromium worker + BrowserHive)を Apple Container 上に立てる
---

スタックは `docker-compose.yml` に宣言され、
[container-compose](https://github.com/Mcrich23/Container-Compose) が
[Apple Container](https://github.com/apple/container)
(macOS 26+・Apple Silicon)上で駆動する: entrypoint に bucket 初期化を内蔵した
自己ホスト SeaweedFS、`chromium-server-docker` submodule(固定リリース)から
ビルドされる 1〜3 台の headless chromium worker、そして BrowserHive 本番イメージ。
配線はすべて名前ベース — コンテナ同士はプラットフォーム DNS の
`<service>.browserhive` で到達し合うため、IP の収集はどこにも存在しない。
DNS ドメインはマシンごとに 1 回の設定(Quickstart 参照):
`sudo container system dns create browserhive`。

ポートを公開するのは BrowserHive だけ(`127.0.0.1:8080`)。SeaweedFS と worker
へは DNS 名(ホストローカル)で到達する。

```sh
container-compose up -d -b                     # worker 1 台
container-compose --profile scale2 up -d -b    # worker 2 台
container-compose --profile scale3 up -d -b    # worker 3 台
container logs browserhive.browserhive

# ready を待ってから確認
until curl -sf http://localhost:8080/v1/status >/dev/null; do sleep 1; done
curl -s http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
```

`BROWSERHIVE_BROWSER_URLS` は常に 3 台分を宣言する: scale profile で起動しなかった
worker は `error` と表示され、3 台全部が `ready` になるまで `isRunning` は
`false` のまま。ただし `ready` な worker が 1 台でもあれば capture は流れる —
coordinator は degraded 状態で運転を続け、居ない worker には上限つき指数
バックオフで再試行し続ける。

停止:

```sh
container-compose down                       # 既定(worker 1 台)構成
container-compose --profile scale3 down      # up と同じ profile を渡すこと
```

`down` が止めるのは指定 profile で有効なサービスだけ — profile 付き worker は
渡さないと生き残る。

**worker は 1 台ずつ自由に再起動・作り直しできる**: DNS 名が新コンテナに追従し、
coordinator が数秒で再接続する(検証済み)。それ以外 — seaweedfs・browserhive・
台数変更 — は `up` が稼働中サービスを**再作成する**ため、実質
`container-compose down && container-compose up -d` として扱うこと
(処理中の capture は失われる)。

> **Note:** SeaweedFS のデータ volume(`browserhive_seaweedfs-data`)は全キャプチャ
> 成果物を保持し、`down`/`up` を跨いで残る。バックアップ/ライフサイクルは別途
> 計画すること — `container volume rm browserhive_seaweedfs-data` で消える。
> 外部 S3 構成ではこの volume は使われない。

本番イメージを単体でビルドする場合(レジストリへ push する等):

```sh
container build -f Dockerfile.prod -t browserhive:<version> .
```

外部の S3 互換ストアと既存 worker に向けた単体実行:

```sh
container run --rm -p 127.0.0.1:8080:8080 \
  -e BROWSERHIVE_BROWSER_URLS=http://<worker-ip>:9222 \
  -e BROWSERHIVE_S3_ENDPOINT=https://s3.example.com \
  -e BROWSERHIVE_S3_BUCKET=browserhive \
  -e BROWSERHIVE_S3_ACCESS_KEY_ID=... \
  -e BROWSERHIVE_S3_SECRET_ACCESS_KEY=... \
  browserhive:<version>
```
