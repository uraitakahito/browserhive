---
title: BrowserHive ドキュメント
description: コード(TSDoc)と同期するドキュメント
---

ようこそ。このサイトの**事実**(用語の定義・コード片・型)は browserhive の
TypeScript コードと **`@glossary` タグ / `// #region` から抽出して注入**される。
物語や図は MDX に自由に書く。コード側を直せば、次のビルドでドキュメントも追従する。

## 読む順序

1. [アーキテクチャ解説](/architecture/) — 5 層構成・リクエストの一生・キャプチャ・プロデューサの**全体像**
2. [ワーカーの生成とループ(詳説)](/worker-spawn-and-loop/) — spawn → 接続 → ループ → 停止を実コード片つきで分解
3. [XState 入門 + BrowserHive で使う機能](/xstate-primer/) — 状態機械の前提知識(2・1 を読む前提)

## 用語リソース(3 種)

- [用語集](/terminology/) — `src` の `@glossary` から**自動生成**される BrowserHive コンポーネント定義
- [用語リファレンス](/glossary-reference/) — WACZ 形式 / XState API の用語(手書き)
- [WACZ 用語の使い分け](/wacz-vocabulary/) — WACZ を語るときの語彙規律(「zip」ではなく「ZIP file」等)
