---
title: WACZ internals
description: BrowserHive がキャプチャを ReplayWeb.page 互換の WACZ にエンコードする方法 — WARC パイプライン・CDXJ・replay 契約・仕様と実装の食い違い
---

BrowserHive が 1 回の Chromium キャプチャを
[ReplayWeb.page](https://replayweb.page/) 互換の WACZ アーカイブへ変換する方法。

## ファイルレイアウト

```
{taskId}_..._labels.wacz                 # ZIP file
├── archive/
│   └── data.warc.gz                     # WARC 1.1 — 全 HTTP 交信
├── pages/
│   └── pages.jsonl                      # ページ一覧(単一エントリ・このキャプチャ)
├── indexes/
│   └── index.cdxj                       # CDXJ — surt ソート・非圧縮(下記 gotcha 参照)
├── fuzzy.json                           # キャッシュバスター除去ルール(Phase 6.4)
└── datapackage.json                     # マニフェスト — ファイル毎の sha256 + bytes
```

ZIP file はタスク毎に 1 回、`src/storage/wacz/packager.ts` で構築される。
各内部ファイルはメモリ上で計算され(キャプチャサイズはタスク上限で有界)、
`datapackage.json` 用にハッシュされ、ZIP file へ追加される。
`archive/data.warc.gz` は再圧縮せずに格納する — WARC 仕様どおり既に gzip 済みで、
二重 deflate は膨らむだけのため。

## WARC パイプライン

WARC ライタ(`src/storage/warc/`)はレコード毎に **独立した gzip member** を
出力する — gzip 形式は member を連結してもペイロードの連結として解凍できることを
保証しており、CDXJ 索引がバイトオフセットでレコードへシークできるのはこの性質による。

タスク毎に出力されるレコード:

| レコード種別 | ソース | 備考 |
|---|---|---|
| `warcinfo` | `NetworkRecorder.start()` | WARC 毎に 1 回。`software`・`format`・`conformsTo` を持つ。 |
| `request` | `loadingFinished` | `WARC-Concurrent-To` で `response` と対。Cookie / Authorization は保持(`*ExtraInfo` が優先)。 |
| `response` | `loadingFinished` | HTTP ステータス行 + ヘッダ + body。`Set-Cookie` 保持。 |
| `metadata` | `loadingFailed`・body 過大・body スキップ・`stop()` 時点で in-flight | リソースが欠けた*理由*を、URL を黙って落とさずに記録する。 |

body バイトは 3 つの独立した上限を通る(`RecordingLimits` 参照):

1. **`maxResponseBytes`** — レスポンス単位。超えた body は
   `metadata { truncated: too-large }` レコードになる。
2. **`maxTaskBytes`** — 累計。超過後は以降のレスポンスすべてが
   `metadata { truncated: task-cap }` を記録する。
3. **`maxPendingRequests`** — in-flight 追跡マップの上限(超過時は FIFO で追い出し)。

## CDXJ 索引

`response` レコード毎に 1 行、形式は
`<surt-url> <yyyymmddhhmmss> <json>` で辞書順ソート。JSON オブジェクトは
ReplayWeb.page が WARC へシークするためのフィールドを持つ: `url`・`mime`・
`status`・`digest`(sha256 base32)・`length`・`offset`・`filename`。
行は URL で重複排除**しない** — 同じ URL が 2 回発火すれば(初回ロードと状態変化後など)
CDXJ も 2 行になり、replay エンジンがページスナップショットに最も近い
タイムスタンプのレスポンスを選べる。

## replay 正しさの契約

| Phase | 契約 | 実装 |
|---|---|---|
| **6.1 時計固定** | `pages.jsonl.ts` と `datapackage.mainPageDate` はキャプチャ開始時刻に等しい。ReplayWeb.page はこれで再生 JS の `Date.now()` / `Date()` / `Math.random()` / `crypto.getRandomValues()` を固定する。 | `PageCapturer.capture` が関数冒頭で一度だけ `capturedAt = new Date(startTime).toISOString()` を設定し、`WaczPackager.pack` へ渡す。 |
| **6.2 ヘッダ完全性** | Cookie / Set-Cookie / Authorization を WARC にそのまま保持。 | `NetworkRecorder` は `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo` のヘッダがあれば常に優先する(到着順に関係なく)。基本イベントはセキュリティ敏感ヘッダを削るが、ExtraInfo は無編集のソース。 |
| **6.3 静的化(複数レスポンス)** | 同一 URL → 複数 WARC レコード → 複数 CDXJ 行。replay はタイムスタンプ最近傍を選ぶ。 | Phase 1 のライタは設計として dedupe しない。CDXJ 生成もレスポンス毎に 1 行、URL による畳み込みなし。 |
| **6.4 ファジーマッチ** | `fuzzy.json` にキャッシュバスター扱いのクエリパラメータ名を列挙。これを尊重する replay エンジン(と BrowserHive 自身のビューア文書)は URL 照合前に除去する。 | `--wacz-fuzzy-param` フラグ → `WaczConfig.fuzzyParams` → `WaczPackager.pack({ fuzzyParams })` → アーカイブルートの `fuzzy.json`。ReplayWeb.page には独自のキャッシュバスター・ヒューリスティックもあり、`fuzzy.json` は前方互換のため。 |

## 並行性モデル

CDP の `Network.*` イベントは EventEmitter に同期的に発火する。1 つの
`requestId` に対する複数イベント(リダイレクトの `requestWillBeSent` → 次の
`responseReceived` → `loadingFinished`)は、どの `await` にも譲る前に立て続けに
届きうる。レコーダの一貫性は 2 つのルールで保つ:

1. **マップ更新は同期で** — `pending` の変更はすべてイベントハンドラ内・
   いかなる `await` より前に行う。リダイレクトの `requestWillBeSent` が
   次ステップ用にスロットを差し替えてから、兄弟の `responseReceived`
   ハンドラが誤ったエントリを読む余地を無くす。
2. **書き込みは `writeQueue` で直列化** — レコード構築は同期のまま、
   `WarcWriter.writeRecord` の呼び出しを単一の `Promise<void>` に連結する。
   連結 gzip member が交錯すれば読めないファイルになるため。

## 将来のスクロール統合

`NetworkRecorder` は `PageCapturer.capture` の最上部でアタッチされ、
`resetPageState` の直前でデタッチされる(`about:blank` は記録されない)。
将来 `page.goto` と各形式キャプチャの間に `scrollBeforeCapture` ステップが
入れば、スクロールが誘発する全リクエストは自動的に WARC に載る —
WACZ 側の変更は不要。

## 仕様と実装の食い違い(E2E デバッグの教訓)

WACZ には <https://specs.webrecorder.net/wacz/1.0.0/> の成文仕様**と**、
[wabac.js](https://github.com/webrecorder/wabac.js) の参照実装がある。
両者はいくつか重要な点で食い違い、仕様だけに従うと WACZ は再生できない。
以下は BrowserHive の WACZ 出力が回避しなければならなかった相違の全記録
(それぞれ ReplayWeb.page での手動往復デバッグ 1 回分の代償)。

### CDX 索引の拡張子は `.cdxj` のみ(`.cdxj.gz` 不可)

仕様は `.cdxj.gz`(gzip 済み CDXJ)も許容と書く。wabac.js の
`multiwacz.ts:loadIndex` は `.cdx`・`.cdxj`・`.idx` しかマッチしない:

```typescript
if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) { ... }
```

`.cdx.gz` / `.cdxj.gz` はどの分岐にも入らず黙ってスキップされ、以後の
URL 照会はすべて「Archived Page Not Found」になる。BrowserHive は
**素の `indexes/index.cdxj`** を出力する。サイズは外側 ZIP file の deflate が賄う。

### CDXJ の `filename` は `archive/` からの相対

仕様の文言は曖昧だが、wabac は WARC 取得時に自分で `archive/` を前置する。
`"filename":"archive/data.warc.gz"` と書くと `archive/archive/data.warc.gz` を
探して 404 になる。`"filename":"data.warc.gz"` と書くこと。

### CDXJ の JSON 値は数値でなく文字列

wacz-creator / pywb の慣習により、`status`・`length`・`offset` は文字列で
出力する(`200` でなく `"200"`)。wabac はパース時に型へ寛容だが、参照 WACZ
ファイルはすべて文字列を使っており、合わせてもコストゼロで他ツールの出力と
バイト一致する。

### `datapackage.json` には `profile: "data-package"` が必須

Frictionless Data Package 仕様は `profile` を必須とし、WACZ 仕様も継承する。
wabac の `loadPackage` は `root.profile` で分岐する:

```typescript
switch (root.profile) {
  case "data-package":
  case "wacz-package":
  case undefined:
  case null:
    return await this.loadLeafWACZPackage(root);  // normal path
  case "multi-wacz-package":
    return await this.loadMultiWACZPackage(root);
  default:
    throw new Error(`Unknown package profile: ${root.profile}`);
}
```

`undefined`/`null` も `loadLeafWACZPackage` には落ちるが、ローダの他の箇所は
`profile` 不在を「WACZ が不完全」の印として扱い、オプション手順(CDX 検証等)を
黙ってスキップする。常に `"profile": "data-package"` を出力すること。

### WARC の `application/http;msgtype=response` は HTTP/1.1 形でなければならない

ワイヤが HTTP/2(や HTTP/3)でも、WARC ペイロードは実務上*常に* HTTP/1.1。
CDP は HTTP/2 のワイヤデータをそのまま渡してくるため、BrowserHive は
`network-recorder.ts` で 4 点を正規化する:

| ワイヤ(CDP) | WARC(HTTP/1.1) | 理由 |
|---|---|---|
| `HTTP/2.0 200`(reason なし) | `HTTP/1.1 200 OK` | RFC 7230 のステータス行形式。reason-phrase はフォールバック表から |
| `:authority`・`:method`・`:path`・`:scheme`・`:status` | (除去) | `:` 接頭辞名は HTTP/1.1 では不正 |
| (`:authority` 除去後) | URL から `Host: …` を合成 | HTTP/1.1 は `Host:` 必須 |
| デコード済み body の隣の `content-encoding: br` | (除去) | `getResponseBody` は平文を返す。エンコーディングヘッダが残ると wabac が再解凍してしまう |
| `transfer-encoding: chunked` | (除去) | chunked はワイヤの関心事。body は今や単一バッファ |
| エンコード時の `content-length` | `Content-Length: <デコード後バイト数>` | 長さは WARC 内の実 body バイトに一致させる |

`buildHttp11RequestHeaders` / `buildHttp11ResponseHeaders` /
`fallbackStatusText` がこの変換を担う。`recordPair` 内で走るため、レコーダを
通る全 WARC レコードは上流のトランスポートに関係なく HTTP/1.1 形になる。

## WACZ に意図的に入れないもの

- **認証フロー / ライブデータ / WebRTC** — 対象外
  ([Replay クイックスタート](/replay-quickstart/)参照)。
- **キャプチャ対象ページの Service Worker 登録** — replay は自前の SW を使う。
  キャプチャした SW は競合する。
- **`maxResponseBytes` 超の画像 / 動画 body** —
  `metadata { truncated: too-large }` として記録。メディアの多いキャプチャでは
  上限をチューニングする。
- **既定ブロックリストのトラフィック**(`google-analytics.com` 等)—
  何も記録しない。`--wacz-block-pattern` で上書き。
