---
title: 仕様の実装状況
description: WARC・WACZ・CDXJ・wacz-auth のうち BrowserHive が実装している範囲と、していない範囲およびその理由
---

BrowserHive は 4 つの仕様に対して書き出しています。このページは、それぞれについて
何を出しているか、何を出していないか、どこで意図的に別の方法を採ったかを述べます。

重要なのは**未実装**と**逸脱**の区別です。フィールドを出さないのは範囲の判断ですが、
仕様が手段を用意しているのに別の道を採ったのなら、それは誰かが行った取捨選択であり、
理由を書き残す価値があります。

:::note
`test/docs/spec-coverage-data.ts` から生成しています。このファイルを直接編集しても
上書きされます。表がコードと合っているかは CI が検査します。
:::

## 概要

| 面 | 被覆 |
| --- | --- |
| WACZ のファイル構成 | 5 / 7 |
| WARC のレコード種別 | 4 / 8 |
| WARC のヘッダフィールド | 13 / 21 |
| CDXJ 索引 | 7 / 8 |
| pages.jsonl | 4 / 6 |
| datapackage.json | 7 / 10 |
| 署名 (wacz-auth) | 1 / 2 |

「被覆」は実装と実装＋補完の合計です。仕様外の拡張は一覧に載せますが分母から外しています。

## WACZ のファイル構成

定義元: WACZ 1.1.1 — WACZ Object

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `archive/data.warc.gz` | 実装 | キャプチャごとに gzip 圧縮した WARC を 1 本。 |
| `indexes/index.cdxj` | 実装 | 素の CDXJ。response レコード 1 本につき 1 行。 |
| `indexes/index.idx (ZipNum)` | 逸脱 | 仕様は gzip 圧縮したクラスタ索引を認めるが、wabac.js が読めない。WACZ を作る目的が replay である以上、読めない形は採れない。 |
| `pages/pages.jsonl` | 実装 | ヘッダ行 ＋ 1 エントリ。1 キャプチャ = 1 ページのため。 |
| `pages/extraPages.jsonl` | 未実装 | クロールで発見したページ用。1 キャプチャ 1 ページなので入れるものがない。 |
| `datapackage.json` | 実装 | Frictionless data package のマニフェスト。リソースごとにハッシュを持つ。 |
| `datapackage-digest.json` | 実装 | 署名を要求したキャプチャ (`signing: true`) で書き出す。datapackage.json の `sha256:` と、署名サービスが返した wacz-auth の signedData を持つ。 |
| `fuzzy.json (non-spec)` | 逸脱 | 仕様に無い。仕様はルートへの追加ファイルを認めており、wabac.js が replay 時の曖昧 URL 照合に読む。 |

## WARC のレコード種別

定義元: WARC 1.1 (ISO 28500) §5

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `warcinfo` | 実装 | WARC ごとに 1 本。software・format・conformsTo を持つ。 |
| `request` | 実装 | WARC-Concurrent-To で response と対にする。 |
| `response` | 実装 | ステータス行・ヘッダ・本文を HTTP/1.1 メッセージとして格納。 |
| `metadata` | 実装 | 本文が無い理由を記録する。落とした URL が黙って消えないようにするため。 |
| `resource` | 未実装 | HTTP 以外で取得した内容用で、代表例は DNS。Chromium の DevTools Protocol はリゾルバの結果を出さない。 |
| `revisit` | 未実装 | 既に別の場所にある payload 用。キャプチャごとに独立した WARC を書き、跨いだ重複排除をしない。 |
| `conversion` | 未実装 | 他レコードを再エンコードした複製用。キャプチャ後に変換を行わない。 |
| `continuation` | 未実装 | ファイルを跨いで分割したレコード用。1 キャプチャは 1 本の WARC に収める。 |

## WARC のヘッダフィールド

定義元: WARC 1.1 (ISO 28500) §5

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `WARC-Record-ID` | 実装 | urn:uuid。response 到着前に採番し、request と相互に指せるようにする。 |
| `WARC-Type` | 実装 | 上記 4 種別のいずれか。 |
| `WARC-Date` | 実装 | WARC 1.1 が認めるミリ秒精度。ただしこれは通信時刻ではなく、レコードを書いた時刻。 |
| `WARC-Target-URI` | 実装 | そのレコードが対象とする URL。 |
| `Content-Type` | 実装 | application/http;msgtype=… または application/warc-fields。 |
| `Content-Length` | 実装 | 保存したレコードブロックのバイト長。 |
| `WARC-Block-Digest` | 実装 | ブロック全体の sha256（base32）。 |
| `WARC-Payload-Digest` | 実装 | 本文の sha256（base32）。本文を落とした response の空ボディも対象にする。 |
| `WARC-Concurrent-To` | 実装 | 同一キャプチャの request・response・metadata を結ぶ。 |
| `WARC-IP-Address` | 実装 | 実際に接続したアドレス。名前解決の記録より強い証跡で、DNS 変更や CDN 切替の後も残る。 |
| `WARC-Filename` | 実装 | warcinfo レコードに付与。 |
| `WARC-Refers-To` | 実装 | metadata レコードから、説明対象の response を指す。 |
| `WARC-Truncated` | 実装＋補完 | 上限で本文を落としたとき `length` を出す。metadata レコードで補完する — 列挙 4 値では元のサイズも、どちらの上限かも表せないため。 |
| `WARC-Warcinfo-ID` | 未実装 | レコードから warcinfo への逆リンク。1 ファイルに warcinfo は 1 本しかないため情報量がない。 |
| `WARC-Profile` | 未実装 | revisit レコードでのみ意味を持つが、そちらが未使用。 |
| `WARC-Identified-Payload-Type` | 未実装 | 宣言された型ではなく、書き手が判別した型。判別処理を行っていない。 |
| `WARC-Refers-To-Target-URI` | 未実装 | revisit 専用。 |
| `WARC-Refers-To-Date` | 未実装 | revisit 専用。 |
| `WARC-Segment-Number` | 未実装 | 分割を使わない（1 キャプチャ 1 ファイル）。 |
| `WARC-Segment-Origin-ID` | 未実装 | 分割を使わない。 |
| `WARC-Segment-Total-Length` | 未実装 | 分割を使わない。 |

## CDXJ 索引

定義元: CDXJ 0.1.0

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `url` | 実装 | 必須。 |
| `digest` | 実装 | 必須。本文を保存しなかった response も含め全行にある — 0 バイトのハッシュは定義されている。 |
| `mime` | 実装 | 必須。 |
| `filename` | 実装 | 必須。pywb・wacz-creator と同じく archive/ からの相対。 |
| `offset` | 実装 | 必須。参照実装に合わせて文字列で出す。 |
| `length` | 実装 | 必須。文字列で出す。 |
| `status` | 実装 | 必須。文字列で出す。 |
| `recordDigest` | 未実装 | 仕様の例には出るが、必須プロパティの一覧には無い。読み手もいない。 |

## pages.jsonl

定義元: WACZ 1.1.1 — pages.jsonl

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `url (MUST)` | 実装 | キャプチャしたページ。 |
| `ts (MUST)` | 実装 | replay の時計 shim がこの値に固定される。Date.now() を URL に埋める JS が同じ URL を再生成できる。 |
| `title (MAY)` | 実装 | ページの <title>。 |
| `id (MAY)` | 実装 | BrowserHive のタスク ID。ログと突き合わせられる。 |
| `text (MAY)` | 未実装 | アーカイブ全文検索用の抽出テキスト。検索機能が無い。 |
| `size (MAY)` | 未実装 | ページと全リソースの合計バイト数。キャプチャ単位では waczStats が既に報告している。 |

## datapackage.json

定義元: WACZ 1.1.1 — datapackage.json

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `profile (MUST)` | 実装 | 文字列 "data-package"。 |
| `resources (MUST)` | 実装 | パッケージ内の全ファイルの name・path・hash・bytes。 |
| `wacz_version (MUST)` | 実装 | "1.1.1"。 |
| `title (SHOULD)` | 実装 | ページタイトル。無ければ URL。 |
| `created (SHOULD)` | 実装 | WACZ を組み立てた日時。 |
| `software (SHOULD)` | 実装 | browserhive とリリース版数。 |
| `mainPageDate (SHOULD)` | 実装 | ページをキャプチャした日時。 |
| `mainPageUrl (SHOULD)` | 逸脱 | `mainPageURL` と書いている。wabac.js がその綴りを読むため。仕様の綴りは `mainPageUrl` で、1.2.0 では削除された。ここは replay を優先している。 |
| `description (SHOULD)` | 未実装 | 長めの説明文。キャプチャに付ける編集的な説明が存在しない。 |
| `modified (SHOULD)` | 未実装 | WACZ は一度書いたら編集しないため `created` と同値になる。 |
| `browserhive:capture (non-spec)` | 逸脱 | 仕様に無い。このキャプチャが取り切れなかったもの ——「304 やサイズ上限で本文を失ったか」(`completeness`) と「スクロールがページの終わりではなく歩数上限で止まったか」(`coverage`)。合意された語彙ではなく我々の観測なので名前空間を切ってある。Frictionless のスキーマは `additionalProperties: false` を持たず、wabac.js はこのファイルから config / profile / metadata / resources しか読まない。 |

## 署名 (wacz-auth)

定義元: WACZ Signing and Verification 0.1.0

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `Anonymous Signature` | 未実装 | 鍵ペアだけで digest に署名する。検証には公開鍵を別経路で配る必要がある。 |
| `Domain-Ownership Identity + Signed Timestamp` | 実装 | キャプチャごとに `signing: true` で要求し、外部の署名サービス (開発では capping) が生成する。BrowserHive はハッシュを送って返ってきたものを格納するだけで、署名鍵を持たない。 |

## 意図的に対象外にしているもの

出していないフィールドとは別に、そもそもキャプチャが保持しようとしないものです。

- **認証フロー / ライブデータ / WebRTC** — [Replay クイックスタート](/replay-quickstart/)を参照。
- **キャプチャ対象ページの Service Worker** — replay は自前の SW を使うため、
  キャプチャした SW は競合する。
- **`maxResponseBytes` を超える本文** — 切り詰めとして記録し、
  キャプチャは自身を不完全として報告する。
- **既定ブロックリストに一致する通信**（`google-analytics.com` 等）— 何も記録しない。

## 関連

- [WACZ internals](/wacz-internals/) — エンコードの仕組みと、デバッグで判明した replay の落とし穴。
- [WACZ 用語の使い分け](/wacz-vocabulary/) — この出力について書くときの語彙。
