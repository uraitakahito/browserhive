---
title: WACZ に署名する
description: キャプチャごとに wacz-auth 署名を要求し、結果を読み、検証する
---
`signing: true` は [wacz-auth](https://specs.webrecorder.net/wacz-auth/0.1.0/)
署名を**要求**します。設定された署名サービスに依頼し、返ってきたものを**検証**し、
WACZ の中に `datapackage-digest.json` として格納します。**署名できなかった
キャプチャは失敗し、成果物は保存されません。**

BrowserHive は署名鍵を持ちません。`datapackage.json` の `sha256:` を送って
返ってきたものを格納するだけなので、キャプチャワーカーが侵害されても第二の
アーカイブを偽造できる立場にありません。開発時のそのサービスは
[capping](https://uraitakahito.github.io/capping/) で、`signing` compose
プロファイルで起動します。

```bash title="署名サービスが動いている必要があります"
container-compose --profile signing up -d -b
```

プロファイルを外しても、署名を要求しないキャプチャは従来どおり動きます。
要求するものは**失敗**し、到達できなかったサービスを名指しします ——
[署名が取得できないキャプチャは失敗します](#署名が取得できないキャプチャは失敗します)を参照。

## 署名付きでキャプチャを依頼する

```bash title="POST /v1/captures"
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "captureFormats": {
      "png":   false,
      "webp":  false,
      "html":  false,
      "mhtml": false,
      "wacz":  true,
      "links": false
    },
    "signing": true
  }' | jq .
```

```json
{
  "accepted": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`signing` には `captureFormats.wacz: true` が要ります。WACZ を作らないキャプチャに
署名を頼むと **400** で拒否されます —— 署名の置き場所が無く、受け付けてしまうと
「頼んだつもり」が残るからです。

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","captureFormats":{"png":true,"webp":false,"html":false,"mhtml":false,"wacz":false,"links":false},"signing":true}'
# → 400
```

## 結果を読む

```bash title="GET /v1/captures/{taskId}"
curl -sS http://localhost:8080/v1/captures/550e8400-e29b-41d4-a716-446655440000 \
  | jq '{status, wacz: .artifacts.wacz, signature}'
```

```json
{
  "status": "success",
  "wacz": "s3://browserhive/550e8400-….wacz",
  "signature": {
    "signed": true,
    "domain": "sign.dev.local",
    "checks": { "signature": "ok", "chain": "ok", "domain": "ok", "timestamp": "ok" }
  }
}
```

`signature` は署名が不要だったキャプチャでは**存在しません**。これは
`signed: false` とは別の答えで、このフィールドが常在ではなく任意である理由です。

### `checks` は「どこまで検証したか」を述べます

`signed: true` は「署名を受け取った」ではなく「**検証した**」を意味します。
`checks` はどの検査が走ったかを示します。

| 検査 | 何が言えるか | 必要なもの |
|---|---|---|
| `signature` | 署名が**このキャプチャが生成した** `datapackage.json` を覆っている（応答が返した hash ではない） | — |
| `chain` | 証明書がこのサーバに設定された root に届く | `BROWSERHIVE_SIGNING_TRUST_ANCHOR` |
| `domain` | 証明書が応答の名乗るドメイン向けに発行されている | — |
| `timestamp` | タイムスタンプトークンが**この**署名を覆っている | `BROWSERHIVE_SIGNING_TIMESTAMP_ANCHOR` |

それぞれ `ok` / `failed` / `skipped` のいずれかです。**`skipped` は合格ではありません。**
chain と timestamp は照合先の信頼アンカーが要り、どちらも未設定のサーバでも残る 2 つは
動きます —— この 2 つは設定不要で、**サービスが別のバイトに署名している事態を捕まえる
のはここ**です。

`failed` の検査が結果として届くことはありません。キャプチャが失敗するからです。
成功したキャプチャの `checks` には `ok` と `skipped` しか現れず、
**それを読むことで自分の構成が実際に何を検証したか**が分かります。

### <span id="署名が取得できないキャプチャは失敗します">署名が取得できないキャプチャは失敗します</span>

サービスが停止している、遅い、トークンを拒否する、あるいは**検証を通らないものを
返した** —— いずれの場合も**キャプチャは失敗し、何も保存されません**。

```json
{
  "status": "failed",
  "errorDetails": {
    "type": "signing",
    "message": "a signature was required and could not be obtained: http://capping.browserhive:8080/sign — fetch failed: getaddrinfo ENOTFOUND capping.browserhive"
  }
}
```

WACZ はアップロードされません —— **そもそも書かれない**ので、中途半端に署名された
成果物が後から見つかることもありません。`errorDetails.type` が `internal` ではなく
`signing` なのは、対処が別種だからです。署名サービスの停止はサービスを再起動して
再試行すれば直り、`internal` は本物の不具合が住む場所です。

以前は逆でした。署名に失敗してもキャプチャは成功しアーカイブはアップロードされ、
結果は誰も読む義務のないフィールドに入っていました —— URL の間違い、トークンの
間違い、誰も起動していないサービス、そのどれもが**問題なさそうに見えて署名されて
いないアーカイブ**を生みました。何も赤くなりませんでした。

:::note[署名なしの保存は変わりません]
`signing` を書かない、または `false` にすれば、署名サービスの有無にかかわらず
従来どおり成功します。失敗するのは**署名を要求して得られなかった場合**だけです。
「取れたら付ける」という段はありません —— サービスがたまたま動いていたかどうかで
価値が変わるアーカイブは、確認しない限り誰も依拠できないからです。
:::

### 何を提供するかはサーバが決めます

`--signing-policy` が配備の方針を定め、要求はその範囲で選びます。

| 方針 | `signing` 未指定 | `signing: true` | `signing: false` |
|---|---|---|---|
| `forbidden` | 署名なし | **400** | 署名なし |
| `optional` *(既定)* | 署名なし | 署名必須 | 署名なし |
| `required` | **署名必須** | 署名必須 | **400** |

`required` は、証拠用の配備が**呼び出し側のフラグ書き忘れに依存しない**ために
あります —— 書き忘れは「署名が取得できなかった」と同じ無音の失敗が 1 段上に
移ったものです。`forbidden` はその鏡で、署名サービスを持たないサーバが
それを理由にキャプチャを失敗させられないようにします。

`--signing-policy required` で `--signing-url` が無いサーバは**起動を拒否します**。
受け付けてしまえば、全キャプチャを 1 件ずつ失敗させ、理由はワーカーログにしか
出ないことになります。

## 署名を検証する

アーカイブを取得し、中から digest を取り出します。

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-….wacz ./capture.wacz

unzip -p capture.wacz datapackage-digest.json > datapackage-digest.json
```

BrowserHive はアーカイブを保存する前に既にこの 4 つを検査しています。ここでの
`capping verify` は最初の検査ではなく**第二の意見**です —— 手元に渡ってきた
アーカイブを確かめたいとき、あるいは他のツールが作ったものを検査したいときに使います。

```console
$ node capping/dist/cli.js verify \
    --file datapackage-digest.json \
    --root test/fixtures/dev-ca/insecure-dev-ca.crt
  ok       signature  signature matches the hash under the certificate's key
  ok       chain      chain reaches a supplied trust root
  ok       domain     certificate is valid for sign.dev.local
  ok       timestamp  timestamp covers this signature

valid
```

`--root` は `test/fixtures/dev-ca/insecure-dev-ca.crt` にコミットしてある開発用 CA です。
どのチェックアウトでも同じであることに意味があります —— 信頼アンカーが固定
されているからこそ、テストが「digest ファイルが現れた」ではなく `valid` を
主張できます。この鍵は誰も信頼していないものに署名しており、CA はどの信頼ストア
にも入っていません。

`--explain` を付けると、各段階の openssl コマンドが印字されます。

:::caution[waxlens は署名を検証しません]
waxlens が見るのは「`datapackage-digest.json` が存在し、その `hash` が
`datapackage.json` と一致するか」までです。**署名・証明書チェーン・domain・
タイムスタンプは見ません**。改竄された `signedData` は waxlens を通り、
`capping verify` で落ちます。
:::

## 設定

| 変数 | 意味 |
|---|---|
| `BROWSERHIVE_SIGNING_POLICY` | `forbidden` / `optional`（既定）/ `required`。この配備が何を提供するか。`required` で URL が無ければ起動を拒否する |
| `BROWSERHIVE_SIGNING_URL` | サービスの `/sign` エンドポイント。未設定なら署名サービス無しで、署名が必要なキャプチャは失敗する（要求ではなくサーバ側の不足として報告される） |
| `BROWSERHIVE_SIGNING_TOKEN` | サービスが要求する場合の bearer トークン |
| `BROWSERHIVE_SIGNING_TIMEOUT_MS` | 署名を待つ時間。既定 5000 |
| `BROWSERHIVE_SIGNING_TRUST_ANCHOR` | 署名証明書を発行した root の PEM。未設定なら chain 検査は `skipped` となり、**どの CA の署名でも受け入れる** |
| `BROWSERHIVE_SIGNING_TIMESTAMP_ANCHOR` | 時刻認証局を発行した root の PEM。未設定なら timestamp 検査は `skipped` |

すべて同名の CLI フラグがあります（`--signing-policy` など）。

dev スタックでは方針以外を `docker-compose.yml` が設定し、**両方のアンカーは
capping が署名に使う identity を指しています** —— 開発時も 2 つではなく
4 つの検査を通すためです。capping が起動するのは `--profile signing` のときだけです。

:::caution[開発用 CA を弾くのはアンカーです]
本番サーバが `BROWSERHIVE_SIGNING_TRUST_ANCHOR` に実在の root を設定していれば、
`insecure-dev-` の CA が署名したものは chain 検査で落ち、署名必須ならキャプチャが
失敗します。アンカーを未設定にすると検査は `skipped` になり —— アーカイブには
そう記録されますが —— **開発用の署名が本番のアーカイブに入る経路は塞がれません**。
:::

## アーカイブに何が入るか

```json title="WACZ ルートの datapackage-digest.json"
{
  "path": "datapackage.json",
  "hash": "sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c",
  "signedData": {
    "hash": "sha256:0be7b2fe…",
    "created": "2026-08-02T00:00:00.000Z",
    "software": "capping/0.3.0",
    "signature": "MEQCIGS0Ydsd…",
    "domain": "sign.dev.local",
    "domainCert": "-----BEGIN CERTIFICATE-----\n…",
    "timeSignature": "MIIJHTADAgEAMIIJFAYJ…",
    "timestampCert": "-----BEGIN CERTIFICATE-----\n…"
  }
}
```

`hash` が覆うのは `datapackage.json` で、それが他のすべてのファイルを覆っています ——
つまり**署名 1 つで WACZ 全体に届きます**。

BrowserHive が実装しているのは仕様の **Domain-Ownership Identity + Signed
Timestamp** 形式です。Anonymous Signature 形式は未実装です
（[仕様カバレッジ](/spec-coverage/)を参照）。

## 関連リンク

- [Replay クイックスタート](/replay-quickstart/) — WACZ の記録と再生
- [仕様カバレッジ](/spec-coverage/) — WACZ / WARC / wacz-auth のどこを使っているか
- wacz-auth 仕様: <https://specs.webrecorder.net/wacz-auth/0.1.0/>
- capping: <https://uraitakahito.github.io/capping/ja/>
