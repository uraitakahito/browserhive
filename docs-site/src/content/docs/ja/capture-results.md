---
title: キャプチャ結果
description: 投げた capture がどうなったかを知る方法 — タスク単位のエンドポイント・耐久性のある .result.json マニフェスト・使い分け
---

`POST /v1/captures` は fire-and-forget で、**202** と `taskId` を返して終わり、
キャプチャは後から走る。このページはその後半 ― そのタスクがどうなったかを
知る方法について。

問い合わせ先は 2 つあり、**返る内容は同じ**なので、パーサは 1 つで済む:

| | 場所 | 寿命 |
|---|---|---|
| `GET /v1/captures/{taskId}` | サーバのメモリ | 上限つき・再起動で消える |
| `{taskId}_..._{labels}.result.json` | 成果物と同じバケット | 成果物と同じ耐久性 |

## レポートの中身

```json
{
  "taskId": "2b9e63ec-06e6-47cc-ab37-cb8495993cd6",
  "correlationId": "abc123de",
  "url": "http://example.com/",
  "labels": ["smoke"],
  "status": "success",
  "httpStatusCode": 200,
  "timestamp": "2026-07-29T12:01:41.870Z",
  "captureProcessingTimeMs": 5971,
  "retryCount": 0,
  "workerIndex": 0,
  "artifacts": {
    "wacz": "s3://browserhive/2b9e63ec-..._abc123de_smoke.wacz"
  },
  "waczStats": { "totalRecorded": 2, "totalBodyBytes": 187, "totalBlocked": 0 },
  "completeness": { "bodylessUrls": [], "complete": true }
}
```

`status` は `success` · `failed` · `timeout` · `httpError` のいずれか。
**成果物があるのは `success` のときだけ**で、残り 3 つは `artifacts` が空になり
`errorDetails` に理由が入る:

```json
{
  "taskId": "bb9b7bb7-d24e-4d55-8169-f5820d14aff0",
  "status": "failed",
  "retryCount": 2,
  "artifacts": {},
  "errorDetails": {
    "type": "internal",
    "message": "net::ERR_CONNECTION_REFUSED at http://example.com/"
  }
}
```

`artifacts` には[成果物ストア](/ja/storage/)が返した値がそのまま入るので、
ファイル名の規則から鍵を組み立て直す必要はない ― S3 互換ストレージなら
`s3://bucket/key` 形式の URI。

## アーカイブは自分の欠けを名乗る

`completeness` は API 応答にも入るが、**同じものが WACZ の
`datapackage.json` にも書き込まれる**。アーカイブは単独で流通し、
API 応答は流通しないからだ —— 3 年後に WACZ を開いた人が
「これは全部入っているのか」を問える先は、ファイルしかない。

```json title="datapackage.json（WACZ の中）"
{
  "profile": "data-package",
  "wacz_version": "1.1.1",
  "browserhive:capture": {
    "completeness": { "bodylessUrls": [], "truncatedUrls": [], "complete": true },
    "coverage": { "scrollExhausted": true, "scrollSteps": 40, "scrolledPx": 32000 }
  }
}
```

**`completeness` と `coverage` は別の問いに答える。**

`completeness` は「記録した応答のうち本文を失ったものはあるか」。
`304` やサイズ上限で落ちた本文を数える。WARC だけを見て決まる。

`coverage` は「そもそもページのどこまで到達したか」。
`scrollExhausted: true` は、スクロールが**ページの終わりではなく歩数上限で止まった**
ことを意味する —— その下にあったものは要求すらされていないので、
WARC には痕跡が残らない。上の例は www.yahoo.co.jp の実測値で、
無限スクロールのフィードを 40 歩（1280×800 のビューポートで 32,000px）で
打ち切っている。**このとき `complete` は `true` のままである。**
どちらも正しく、答えている問いが違う。

`coverage` は behavior が動かなかったときは**丸ごと現れない**。
「見ていない」と「全部見た」は別の主張なので、既定値を書かない。

打ち切られる側は meadow の [`/endless-feed`](https://uraitakahito.github.io/meadow/ja/scenarios/)
——**スクロールしても底に着かないページ**—— に対して e2e で検査している。
以前は実在のサイトに対して手で確かめるしかなかった。

:::note
署名を要求したキャプチャでは、この申告も署名に覆われる ——
署名は `datapackage.json` を対象にしているため。
**後から書き換えられない主張**になる。
:::

## サーバに問い合わせる

```bash
curl -sS -o result.json -w '%{http_code}\n' \
  http://localhost:8080/v1/captures/2b9e63ec-06e6-47cc-ab37-cb8495993cd6
```

| コード | 意味 |
|--------|------|
| `200` | 完了。`result.json` が上のレポート。 |
| `202` | まだキューにいるか処理中(リトライ中も含む)。もう一度問い合わせる。 |
| `404` | 投げられていない、**または**キャッシュから溢れた。 |

404 がこの 2 つを区別しないのは意図的で、結果が溢れた時点でサーバは
区別に必要な情報を持っていない。**404 を「そのタスクは存在しなかった」の
証拠として読んではいけない。**

キャッシュは直近 `--result-cache-size` 件だけを保持し(既定 1000、古いものから
破棄)、再起動では残らない。[環境変数](/ja/environment-variables/)を参照。

## マニフェストを読む

完了したキャプチャは**成功・失敗を問わず**、同じレポートを成果物と同じ
命名規則でバケットにも書く:

```
{taskId}_{correlationId}_{labels}.result.json
```

```bash
aws --endpoint-url http://localhost:8333 s3 cp \
  s3://browserhive/2b9e63ec-..._abc123de_smoke.result.json - | jq .status
```

**結果を取りこぼしてはいけない**用途 ― たとえば自前の台帳を持つクライアント
― ではこちらを使う。キャッシュからの破棄にも、サーバ再起動にも、消費側が
数時間止まっていたことにも耐える。エンドポイントは手軽な方、マニフェストは
確実な方。

:::caution[マニフェストの書き込みだけが失敗することはある]
マニフェストを書く時点でキャプチャと成果物のアップロードはすでに成功して
いるので、ここでの失敗はログに出す(`Failed to write result manifest`)だけで
無視する ― キャプチャを失敗扱いにはしない。そもそもオブジェクトストアに
到達できないなら、成果物もアップロードされていない。
:::

## 全体の件数

`/v1/status` はタスクではなくサーバについて答える。キューの深さと 2 本の
累計カウンタを返す:

```bash
curl -sS http://localhost:8080/v1/status | jq '{pending, processing, succeeded, failed}'
```

`succeeded` と `failed` を分けているのは意図的で、「もうパイプラインにいない」
状態には**成果物ができた場合とリトライ上限を使い切った場合の両方**があり、
自前の記録と突き合わせる側にとってこの 2 つは同じではない。

`/v1/status` はキューを出たタスクについては何も言わないし、
`queue.pendingTasks` は `pendingLimit` で打ち切られる ― つまり
**そこに無いからといって完了したとは限らない**。タスク単位の問いには
`GET /v1/captures/{taskId}` を使う。
