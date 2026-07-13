---
title: WACZ 用語の使い分け
description: WACZ 出力を語るときの語彙規律(ubiquitous language)
---

browserhive は WACZ ファイルを生成する。WACZ 出力について書くコメントや
ドキュメントでは、[WACZ 1.1.1 Terminology](https://specs.webrecorder.net/wacz/1.1.1/#terminology)
([日本語訳](https://uraitakahito.github.io/specs/wacz/1.1.1/#terminology))の
正規の用語を共通言語(ubiquitous language)として使う。

これは**コンポーネント用語集**(`@glossary` から生成される[用語集](/terminology/))
とは別物で、「どの単語を使い、どの単語を避けるか」という**書き方の規律**である。

| 概念 | 使う | 避ける | 対象外(別文脈 / 識別子) |
|------|------|--------|---------------------------|
| ZIP コンテナ | `ZIP file` / `ZIP` | 小文字の `zip` | `zip` 変数、`zip.append`、メディアタイプ literal の `application/wacz+zip`、`gzip`、`.zip` 拡張子 |
| メディアタイプ | `Media Type` | `MIME`(WACZ を語る散文では) | CDP の `mimeType` フィールド、HTTP の `Content-Type` ヘッダ、`--wacz-skip-content-types` フラグ、CDXJ の literal フィールド `mime` |
| ページ | `Page` | `page`(WACZ の pages.jsonl エントリ) | ライブの Playwright / ブラウザの `page` |
| ウェブアーカイブ | `Web Archive` | 裸の `archive`(ウェブアーカイブ全体) | WACZ 内の `archive/` ディレクトリ |
| パッケージ | `Package` | — | npm の `package` |
| コンテキスト | `Context` | — | XState / ブラウザ / 実行コンテキスト |

## ルール

このリポジトリは 2 つの境界づけられたコンテキスト(bounded context)にまたがる。
コメントが**実際に何を説明しているか**に合わせて語彙を選ぶ:

- **WACZ パッケージング**(`src/storage/wacz/**` 層、[WACZ internals](/wacz-internals/)、
  配信される出力):WACZ Terminology の用語 — `ZIP file`、`Media Type`、`Page` — を使う。
- **キャプチャ / CDP / HTTP**(`src/capture/**` 層):そのコードが記述している
  元の語彙を保つ — Chromium DevTools Protocol の `mimeType`、HTTP の
  `Content-Type`、Playwright の `page`。これらを無理に WACZ 用語へ寄せると、
  散文が記述対象のコードと食い違ってしまう。

コード識別子・文字列 literal(例: `application/wacz+zip` メディアタイプ)・
CLI フラグ名は決して書き換えない — これはドキュメント / コメントのルールである。
