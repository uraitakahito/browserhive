---
title: 仕様書リンク集
description: BrowserHive が書き出しているフォーマットの規格 — 日本語訳のあるもの、英語しかないもの、そしてどれがどの版に対応するか
---

BrowserHive が出力するファイルは、すべてどこかの規格に従っています。
「この項目は何のためにあるのか」を調べたくなったとき、探す場所をここにまとめます。

**日本語訳のあるものを先に並べています。** 訳はいずれも非公式訳で、
正典は英語原典です。判断の根拠にする場面では原典を確認してください。

## 日本語訳があるもの

### WACZ 1.1.1

[日本語訳](https://uraitakahito.github.io/specs/wacz/1.1.1/) ·
[英語原典](https://specs.webrecorder.net/wacz/1.1.1/)

**BrowserHive が書き出しているのはこの版です** —— `datapackage.json` の
`wacz_version` に `"1.1.1"` を入れています。ZIP の中の
`archive/` `indexes/` `pages/` という構成も、`datapackage.json` の必須項目も、
ここに書かれています。

### WACZ Signing and Verification 0.1.0

[日本語訳](https://uraitakahito.github.io/specs/wacz-auth/0.1.0/) ·
[英語原典](https://specs.webrecorder.net/wacz-auth/0.1.0/)

`datapackage-digest.json` と、その中の `signedData` の形。
[WACZ に署名する](/ja/signing/)で扱っている内容の規格側です。

### Data Package（Frictionless Data）

[日本語訳](https://uraitakahito.github.io/datapackage/ja/) ·
[英語原典](https://datapackage.org/)

**WACZ はこの規格の上に建っています。** `datapackage.json` という名前も、
`profile` `resources` `path` `hash` といった項目名も、元はこちらのものです。
WACZ 仕様が `[[FRICTIONLESS-DATA-PACKAGE]]` として参照しているのがこれです。

よく引くページ:

| | |
|---|---|
| [Data Package](https://uraitakahito.github.io/datapackage/ja/standard/data-package/) | `datapackage.json` 本体の仕様。BrowserHive が `profile: "data-package"` を入れている理由 |
| [Data Resource](https://uraitakahito.github.io/datapackage/ja/standard/data-resource/) | `resources[]` の各要素。`path` `name` `hash` `bytes` |
| [Table Schema](https://uraitakahito.github.io/datapackage/ja/standard/table-schema/) | 表形式データの列定義。WACZ では使いません |
| [用語集](https://uraitakahito.github.io/datapackage/ja/standard/glossary/) | 規格中の語の定義 |

## 英語のみ

こちらは訳がありません。[specs フォーク](https://uraitakahito.github.io/specs/)には
原典のコピーが置いてありますが、中身は英語のままです。

| 仕様 | 何が書いてあるか |
|---|---|
| [WARC 1.1](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/) | `archive/*.warc.gz` の中身。レコード種別、必須ヘッダ、`WARC-Date` の意味 |
| [WACZ 1.2.0](https://uraitakahito.github.io/specs/wacz/1.2.0/) | 次の版。BrowserHive はまだ書き出していません |
| [CDXJ 0.1.0](https://uraitakahito.github.io/specs/cdxj/0.1.0/) | `indexes/` の索引フォーマット |
| [WACZ use cases](https://uraitakahito.github.io/specs/use-cases/0.1.0/) | WACZ が何のために作られたか |
| [WACZ-IPFS](https://uraitakahito.github.io/specs/wacz-ipfs/latest/) | IPFS 上での配布。BrowserHive の範囲外 |
| [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161) | タイムスタンプ。`signedData` の `timeSignature` が持っているもの |
| [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) | BrowserHive が Chromium を操作している手段 |

## BrowserHive がどこまで実装しているか

規格そのものではなく「BrowserHive が何を出していて何を出していないか」を知りたい場合は、
[仕様の実装状況](/ja/spec-coverage/)を見てください。
**未実装**と**意図的な逸脱**を分けて書いてあります。
