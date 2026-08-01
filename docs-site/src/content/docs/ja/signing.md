---
title: WACZ に署名する
description: キャプチャごとに wacz-auth 署名を要求し、結果を読み、検証する
---

`signing: true` を付けると、設定された署名サービスに
[wacz-auth](https://specs.webrecorder.net/wacz-auth/0.1.0/) の署名を要求し、
WACZ の中に `datapackage-digest.json` として格納します。

BrowserHive は署名鍵を持ちません。`datapackage.json` の `sha256:` を送って、
返ってきたものを格納するだけです。だからキャプチャ側が侵害されても、2 本目の
アーカイブに署名できる材料は手に入りません。開発時のサービスは
[capping](https://uraitakahito.github.io/capping/ja/) で、compose の `signing`
プロファイルで起動します。

```bash title="署名サービスが動いている必要があります"
container-compose --profile signing up -d -b
```

プロファイルを付けなくても他はすべて動きますが、署名を要求したキャプチャは
すべて `signature.signed: false` で返ります。
[壊れていても何も起きません](#壊れていても何も起きません)を参照してください。

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
  "signature": { "signed": true, "domain": "sign.dev.local" }
}
```

`signature` には **3 つの状態**があり、それぞれ別の答えです。

| `signature` | 意味 |
|---|---|
| 不在 | 署名を頼んでいない |
| `{ "signed": true, "domain": … }` | そのドメインの証明書で署名された |
| `{ "signed": false, "reason": … }` | 頼んだが、付かなかった。`reason` が理由 |

### 署名の失敗はキャプチャの失敗ではありません

サービスが落ちている・遅い・トークンを拒否した場合でも、**WACZ は書き出され**、
キャプチャは成功します。

```json
{
  "status": "success",
  "wacz": "s3://browserhive/550e8400-….wacz",
  "signature": {
    "signed": false,
    "reason": "http://capping.browserhive:8080/sign — fetch failed: getaddrinfo ENOTFOUND capping.browserhive"
  }
}
```

これは意図した設計です。誰かが副署したかどうかに関わらずアーカイブは残す価値が
ありますし、署名サービスの不調でキャプチャを失う理由はありません。`reason` には
**エンドポイントと根本原因**が入るので、「ただ失敗した」ではなく診断になります ——
上の `ENOTFOUND` は「コンテナが起動していない」と言っています。

### <span id="壊れていても何も起きません">壊れていても何も起きません</span>

この方針の代償ははっきり書いておきます。URL の間違い・トークンの間違い・
誰も起動していないサービス —— そのどれもが**成功したキャプチャと、アップロードされた
WACZ** を生みます。何も赤くなりません。

つまり `signature.signed` は飾りではなく、**署名済みかどうかを区別する唯一のもの**
です。確認することがそのまま運用の作法になります。

```bash title="署名なしで返ってきたらスクリプトを落とす"
curl -sS "http://localhost:8080/v1/captures/$TASK_ID" \
  | jq -e '.signature.signed == true' > /dev/null \
  || echo "unsigned — container logs capping.browserhive を確認してください"
```

## 署名を検証する

アーカイブを取得し、中から digest を取り出します。

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-….wacz ./capture.wacz

unzip -p capture.wacz datapackage-digest.json > datapackage-digest.json
```

署名そのものを検証できるのは `capping verify` だけです。

```console
$ node capping/dist/cli.js verify \
    --file datapackage-digest.json \
    --root test/fixtures/dev-ca/ca.crt
  ok       signature  signature matches the hash under the certificate's key
  ok       chain      chain reaches a supplied trust root
  ok       domain     certificate is valid for sign.dev.local
  ok       timestamp  timestamp covers this signature

valid
```

`--root` は `test/fixtures/dev-ca/ca.crt` にコミットしてある開発用 CA です。
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
| `BROWSERHIVE_SIGNING_URL` | サービスの `/sign` エンドポイント。未設定なら署名サービス無しで、要求したキャプチャは `signed: false` になる |
| `BROWSERHIVE_SIGNING_TOKEN` | サービスが要求する場合の bearer トークン |
| `BROWSERHIVE_SIGNING_TIMEOUT_MS` | 署名なしに切り替えるまでの待ち時間。既定 5000。署名は任意なので、これがキャプチャに掛けられる上限 |

dev スタックでは前 2 つを `docker-compose.yml` が設定します。capping が起動するのは
`--profile signing` のときだけです。

## アーカイブに何が入るか

```json title="WACZ ルートの datapackage-digest.json"
{
  "path": "datapackage.json",
  "hash": "sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c",
  "signedData": {
    "hash": "sha256:0be7b2fe…",
    "created": "2026-08-02T00:00:00.000Z",
    "software": "capping/0.2.0",
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
