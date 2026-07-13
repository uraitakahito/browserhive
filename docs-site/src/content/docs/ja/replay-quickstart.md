---
title: Replay クイックスタート
description: WACZ キャプチャの記録と ReplayWeb.page での再生 — 忠実に再生されるもの・対象外のもの
---

BrowserHive の `wacz` キャプチャ形式は、キャプチャ中に Chromium が行った
すべての HTTP 交信(ナビゲーションリクエスト、CSS / 画像 / フォント /
API 呼び出しの全て)を 1 つの
[WACZ](https://specs.webrecorder.net/wacz/1.0.0/) アーカイブに記録する。
結果は完全に再生可能なページのスナップショット — 描画された DOM、その裏の
ネットワーク交信、そして(将来のスクロール連携で)ユーザ操作が誘発する
遅延読み込みリソースまで。

## キャプチャを記録する

`captureFormats.wacz: true` でリクエストを送る:

```sh
curl -s -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.example.com/",
    "labels": ["example"],
    "captureFormats": {
      "png": false, "webp": false, "html": false,
      "links": false, "mhtml": false,
      "wacz": true
    }
  }'
```

成果物は設定済み S3 bucket に
`s3://<bucket>/[<prefix>/]<taskId>_..._labels.wacz` としてアップロードされる。
worker の `Task completed` ログ行が `s3://` URI と、WARC に何が入ったかを
まとめた `waczStats` オブジェクトを持つ:

```json
{
  "msg": "Task completed",
  "url": "https://www.example.com/",
  "waczLocation": "s3://browserhive/550e8400-..._example.wacz",
  "waczStats": {
    "totalRecorded": 12,
    "totalBlocked": 1,
    "totalSkippedContentType": 0,
    "totalTruncatedTooLarge": 0,
    "totalTruncatedTaskCap": 0,
    "totalFailed": 0,
    "totalIncomplete": 0,
    "totalBodyBytes": 348201
  }
}
```

## WACZ を ReplayWeb.page で開く

いちばん簡単な方法: S3 から `.wacz` をダウンロードして
[https://replayweb.page/](https://replayweb.page/) にドラッグ&ドロップする。
ビューアはアーカイブをローカルで読み込み(ファイルはブラウザの外に出ない)、
記録済み WARC から各ネットワークリクエストを再生して、キャプチャ時に
Chromium が見たとおりのページを描画する。

埋め込みビューアには、`replaywebpage` Web コンポーネントを自分の HTML に置く:

```html
<!doctype html>
<script src="https://replayweb.page/sw.js"></script>
<script src="https://cdn.jsdelivr.net/npm/replaywebpage/ui.js"></script>

<replay-web-page
  source="https://your-bucket.s3.amazonaws.com/path/to/capture.wacz"
  url="https://www.example.com/"
  embed="replayonly"
></replay-web-page>
```

ReplayWeb.page は再生ページが行うすべての `fetch` / XHR を横取りし、
一致するレスポンスを WARC から返す。URL が厳密一致しない場合
(キャッシュバスター・時刻依存パラメータ)は内蔵のファジーマッチに
フォールバックする。BrowserHive も WACZ ルートに `fuzzy.json`
(パラメータ除去ルールのリスト)を同梱しており、将来の replay エンジンが
参照できる(パラメータ一覧は `--wacz-fuzzy-param` で設定可能)。

## 忠実に再生されるもの

BrowserHive の WACZ 出力は static-shape の契約をカバーする:

- **HTML・CSS・フォント・画像・インラインスクリプト** — ドキュメントと、
  それが参照する全リソース。
- **JS が組み立てる URL** — `fetch('/api/users/' + urlParam.id)` は、
  ライブの JS が同じ入力から同じ URL を再構築する限り機能する。
- **遅延読み込み画像** — スクロール連携が入れば、IntersectionObserver が
  再生時にも同じ fetch を発火し、すべて WARC から供給される。
- **キャッシュバスターのクエリパラメータ** — `?_=${Date.now()}` 等は
  ReplayWeb.page 内蔵のファジーマッチ(と BrowserHive の `fuzzy.json`)で
  正規化され、ライブ URL が記録済み URL に一致する。

## 再生されないもの(対象外)

レコーダは元の交信を忠実に記録するが、**サーバ状態に依存する動的トラフィックは
再生できない** — 再生時の JS が、もう存在しない外部状態を呼び出すことになるため:

- **認証フロー** — 期限切れする JWT・OAuth リフレッシュ・リクエスト毎の
  CSRF トークン。再生時の JS は新しいトークンを生成するが、WARC に一致する
  レスポンスは無い。
- **ライブデータ** — リアルタイム株価・チャットの WebSocket フレーム・
  SSE ストリーム・WebRTC。レコーダはプロトコルを記録するが、再生は毎回
  変わる値を再現できない。
- **Service Worker のオフラインキャッシュ** — ReplayWeb.page 自身が
  Service Worker を使うため、キャプチャ対象ページの SW 登録は再生時に
  無視される。

キャプチャ対象がこれらに依存する場合、下流のツールは WACZ を
「再生可能なインタラクティブスナップショット」ではなく
「フォレンジック記録(キャプチャ時点のネットワークの真実)」として扱うこと。

## チューニング

| 関心事 | ノブ | 既定 |
|---|---|---|
| レスポンス単体の body が大きすぎる | `--wacz-max-response-bytes` | 20 MB |
| 累計 body の肥大化 | `--wacz-max-task-bytes` | 200 MB |
| 広告 / analytics を WARC から除外 | `--wacz-block-pattern` | 同梱リスト(`*://*.google-analytics.com/*` 等) |
| 動画 / 音声の body をスキップ | `--wacz-skip-content-types` | (空) |
| キャッシュバスターのファジー除去 | `--wacz-fuzzy-param` | `_,cb,nocache,t,nonce,timestamp,_t,_v,ts` |

各フラグには `BROWSERHIVE_WACZ_*` の env 版がある
([環境変数](/environment-variables/)を参照)。可変長フラグは CLI では複数値、
env ではカンマ区切り。

## トラブルシューティング

- **再生ページの画像 / CSS が欠ける** — worker ログの `waczStats` を確認:
  `totalBlocked > 0` は、ページが実際に必要としたリソースにブロックパターンが
  当たった印。パターンを絞るか、`--wacz-block-pattern ""` で既定なしから始める。
- **`waczStats.totalTruncatedTaskCap > 0`** — 累計 body 上限に到達。ページが
  正当に数百 MB のリソースを持つなら `--wacz-max-task-bytes` を上げる。
- **再生で「no matching response」** — 再生時に fetch されたリソースに記録済みの
  対応が無い。多くはファジーマッチが拾えなかった新しいキャッシュバスター値が
  原因。そのパラメータ名を `--wacz-fuzzy-param` に足す。
- **認証壁のあるサイトが再生で壊れて見える** — 想定どおり(上の「対象外」参照)。
  ログアウト状態の変種をキャプチャするか、再生は静的ページ状態の読み取り専用と
  割り切る。

## 関連リンク

- WACZ 仕様: <https://specs.webrecorder.net/wacz/1.0.0/>
- WARC 1.1 仕様: <https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/>
- ReplayWeb.page: <https://replayweb.page/>
- WACZ の内部実装(BrowserHive のエンコーディング判断): [WACZ internals](/wacz-internals/)
