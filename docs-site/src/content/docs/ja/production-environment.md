---
title: 本番環境
description: bin/up.sh でフルスタック(SeaweedFS + chromium worker + BrowserHive)を Apple Container 上に立てる
---

スタックは [Apple Container](https://github.com/apple/container)
(macOS 26+・Apple Silicon)上で動く: bucket 初期化 one-shot つきの自己ホスト
SeaweedFS、`chromium-server-docker` submodule(固定リリース)からビルドされる
N 台の headless chromium worker、そして BrowserHive 本番イメージ。
`bin/up.sh` が必要な `BROWSERHIVE_*` 設定をすべて供給する — worker の URL と
S3 エンドポイントは起動時にコンテナ IP として収集され、環境変数に焼き込まれる。

ポートを公開するのは BrowserHive だけ(`127.0.0.1:8080`)。SeaweedFS と worker
へはコンテナ固有 IP(`192.168.64.0/24`・ホストローカル)でのみ到達できる。

```sh
./bin/up.sh 2                        # または 4, 8, ...
container logs browserhive

# 確認
curl http://localhost:8080/v1/status
./bin/status.sh
```

停止:

```sh
./bin/down.sh
```

再起動は常に `./bin/down.sh && ./bin/up.sh N` — コンテナ IP は再起動で変わるため、
部分再起動は設計として非サポート。

> **Note:** SeaweedFS のデータ volume(`seaweedfs-data`)は全キャプチャ成果物を
> 保持し、`down.sh`/`up.sh` を跨いで残る。バックアップ/ライフサイクルは別途
> 計画すること — `container volume rm seaweedfs-data` で消える。外部 S3 構成では
> この volume は使われない。

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
