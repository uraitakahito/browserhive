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
- [container-compose](https://github.com/Mcrich23/Container-Compose)
  (`brew install container-compose`)
- 一度だけ: `sudo container system dns create browserhive` — スタックの
  `<service>.browserhive` 名をコンテナからもこの Mac からも解決可能にする
  ローカル DNS ドメインの登録
- `curl` と `jq` コマンド

## Step 1 — リポジトリを取得する

```bash
git clone --recurse-submodules https://github.com/uraitakahito/browserhive.git
cd browserhive
```

## Step 2 — スタックを起動する

```bash title="SeaweedFS + chromium worker + BrowserHive"
container-compose up -d -b
```

すべて Apple Container 上のコンテナ(軽量 VM)として起動し、プラットフォーム
DNS 名で配線されます。ホストに公開されるのは BrowserHive の 8080 だけです。
既定は chromium worker 1 台 — `--profile scale2` / `--profile scale3` で
最大 3 台まで増やせます。

| コンポーネント | アドレス | 用途 |
|----------------|----------|------|
| BrowserHive API | http://localhost:8080 | キャプチャ受付 |
| SeaweedFS S3 / Filer | `http://seaweedfs.browserhive:8333` / `:8888` | 成果物の保存先 |
| chromium worker | `http://chromium-N.browserhive:9222` | CDP。目視は `chrome://inspect` |

状態を確認します(まだ起動していなければ curl がそのまま失敗を報告します):

```bash
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["ready"] }
```

上の `workers` が 1 要素なのは、`BROWSERHIVE_BROWSER_URLS` に 3 台書いてあっても
**起動しているコンテナだけが worker として登録される**からです: browserhive は
各ホストを DNS で解決し、名前が引けないもの(= そのプロファイルで起動していない
コンテナ)を除外します(起動時に 1 回ログ)。`--profile scale2` / `scale3` で
増やすと **browserhive を再起動せずにライブで編入**されます。

## Step 3 — 最初のキャプチャをリクエストする

`POST /v1/captures` はリクエストを受け付けると **202** を即座に返します
(実際のキャプチャは非同期で実行されます)。

```bash
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
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

:::tip[`--fail-with-body` を付ける理由]
リクエストが拒否されると **400** と RFC 7807 の
`application/problem+json` が返り、その `detail` が問題のフィールドを名指しします
(例: `/captureFormats must be object`。`captureFormats` を部分的にしか送らなかった場合は
不足キーが一度に全部列挙されます)。ところが `curl -s` だけだと本文は表示されるものの
**終了コードは 0** のままなので、`taskId` の無いレスポンスを受け取ったまま処理が進み、
作られてもいないタスクをポーリングし始めます。`--fail-with-body` は本文を残したまま
非ゼロで終了します (curl 7.76 以降)。`jq` のフィルタに流す場合は stderr も見てください
— フィルタはエラー本文を `null` に変えてしまい、理由が見えなくなります。
:::

## Step 4 — 処理状況を確認する

Step 3 で得た `taskId` を使って、投げたタスク自身の状態を問い合わせます:

```bash
curl -sS -o /tmp/result.json -w '%{http_code}\n' \
  http://localhost:8080/v1/captures/550e8400-e29b-41d4-a716-446655440000
```

- **202** — まだキューにいるか、キャプチャ中です。もう一度問い合わせてください。
- **200** — 完了です。`/tmp/result.json` に結果が入っています:

```bash
jq '{status, artifacts, errorDetails}' /tmp/result.json
```

`status` が `success` のときだけ成果物が作られています。`failed` / `timeout` /
`httpError` は何もアップロードされておらず、理由は `errorDetails` にあります。
**404** は「そんなタスクは投げられていない」か「結果がメモリキャッシュから
溢れた」のどちらかです(`--result-cache-size`、既定 1000)。同じ内容は
`.result.json` としてバケットにも書かれ、こちらは溢れにもサーバ再起動にも
耐えます — [キャプチャ結果](/ja/capture-results/)を参照してください。

タスク単位ではなく全体を見たいときは `/v1/status` がキューの深さと
`succeeded` / `failed` のカウンタを返します:

```bash
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '{pending, processing, succeeded, failed}'
```

## Step 5 — 成果物を取得する

成果物は SeaweedFS の `browserhive` バケットに保存されます。
いちばん簡単なのは **Filer UI** をブラウザで開く方法です:

```text
http://seaweedfs.browserhive:8888/buckets/browserhive/
```

AWS CLI を使う場合(認証必須 — 既定クレデンシャルは browserhive/browserhive):

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 ls s3://browserhive/

# WACZ をダウンロード (taskId は Step 3 のレスポンスから)
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-e29b-41d4-a716-446655440000.wacz ./capture.wacz
```

### WACZ を ReplayWeb.page で再生する

1. [replayweb.page](https://replayweb.page/) を開く
2. "Choose File" → `capture.wacz` を選択
3. ページ一覧が表示されたら URL をクリックして再生

## 開発中: ソースを変更したら作り直す

BrowserHive のイメージはビルド時にソースを取り込む(`Dockerfile.prod`)ため、
コードを変更したら**イメージを作り直して**コンテナを再作成します。`-b`(build)
を付けずに `up -d` すると古いイメージが再利用され、変更が反映されません。

開発中はスタックが起動したままのことがほとんどなので、**まず落としてから**
作り直します。前回の実行から残っているコンテナは新しいイメージで確実に
置き換わるとは限らず、そうなると**ビルドは成功しているのにサーバは古いコードを
返し続ける**という、いちばん気付きにくい状態になります。

```bash title="作り直して入れ替える — 成果物は volume に残る"
container-compose down
GIT_REV=$(git rev-parse --short HEAD) container-compose up -d -b
```

`GIT_REV` はコミットを `/v1/status` レスポンスの `build` に焼き込みます。
**毎回確認してください** — 動いているサーバがいま作ったコードかどうかを
教えてくれるのはこれだけです:

```bash
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '.build'
# → { "version": …, "revision": …, "buildTime": … }
# revision が HEAD (git rev-parse --short HEAD) と一致していれば最新
```

`revision` が HEAD と違っていればコンテナが古いので、`container-compose down`
してからビルドし直します。

chromium / SeaweedFS は動かしたまま browserhive だけ作り直したい場合は、
スタックを落とす代わりにそのコンテナだけ削除します:

```bash
container stop browserhive.browserhive && container rm browserhive.browserhive
GIT_REV=$(git rev-parse --short HEAD) container-compose up -d -b browserhive
```

環境変数(`docker-compose.yml`)だけを変えた場合は再ビルド不要ですが、反映には
コンテナの再作成が必要です。同じく `stop` + `rm` してから
`container-compose up -d browserhive` します。

## 片付け

```bash title="成果物は volume (browserhive_seaweedfs-data) に残る"
container-compose down
```

---

## 次のステップ

- [API リファレンス](/api/) — `dismissBanners` / `resetState` / `viewport` など全パラメータの型定義
- [アーキテクチャ解説](/architecture/) — XState ステートマシンと内部構造
- worker の動作確認・目視は chromium-server 側の
  [Verifying workers](https://uraitakahito.github.io/chromium-server-docker/ja/getting-started/verify/) を参照
