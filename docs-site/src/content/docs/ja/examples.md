---
title: examples
description: examples/ にある開発専用ユーティリティ — YAML 駆動のキャプチャクライアント・データファイルのパーサ・カスタム behavior のローダ・data/ のフィクスチャ
---

`examples/` には、動いているサーバを手で叩くためのユーティリティが置いてある。
これらは**開発専用**で、本番ビルドは `src` + `bin` しかコンパイルしないため、
ここのものがランタイムイメージに入ることはない。

| ファイル | 中身 |
|---|---|
| `examples/data-client.ts` | YAML ファイルからキャプチャを投げるクライアント |
| `examples/data-file.ts` | YAML の形式とパーサ |
| `examples/behaviors-loader.ts` | クライアント側のカスタム behavior をホスト単位で読み込む |
| `examples/behaviors/` | その behavior ファイルの置き場所 |

ローダ 2 つがクライアント内のコードでなく別モジュールになっているのは理由が 1 つ:
クライアントのエントリポイントはサーバと話す IIFE だが、データファイルのパースと
ホストに対する behavior の選択は純粋関数だから。切り出しておけば、サーバもディスクも
無しで単体テストできる。

## ビルドの仕方

`pnpm run build` はこれらを出力しない — `tsconfig.build.json` を使い、`src` + `bin`
だけを対象にしているため。別のビルドを使う:

```sh
pnpm run build:examples
```

これは `tsconfig.examples.json` 経由で `src` + `bin` + `examples` をコンパイルする。
そのため `dist/examples/*.js` が `../src/*.js` の import を `dist/src` に対して
解決できる。

## `data-client.ts` — YAML ファイルからキャプチャを投げる

URL の一覧を読み、1 件ずつキャプチャリクエストを投げる。fire-and-forget なので、
クライアントは `202` と `taskId` を受け取ってそこで終わる。キャプチャ自体はサーバ側で
非同期に走るため、このスクリプトが完了を待つことはない — タスクがどうなったかを
知る方法は[キャプチャ結果](/capture-results/)にある。

呼んでいるのは
**[`src/http/openapi.yaml`](https://github.com/uraitakahito/browserhive/blob/main/src/http/openapi.yaml)
から生成された operationId キーの SDK** で、パス・メソッド・リクエスト/レスポンスの
形はすべて仕様から来ている。URL 文字列のハードコードは 1 つも無い。これがこの
サンプルを同梱している意味でもある — 生成されたクライアントが実際に使えることの
確認を兼ねている。

```sh
node dist/examples/data-client.js \
  --data data/smoke-test.yaml --webp --html --links --limit 30 \
  --accept-language "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" \
  | pino-pretty
```

向ける先は動いているサーバ — コンテナスタックか、[開発環境](/development-environment/)の
ホスト開発ループ。`--server` を省くと、生成された SDK に埋め込まれたベース URL
(仕様の `servers[0].url`) を使う。つまり `localhost:8080`。

`pino-pretty` に通すのは任意で、素の出力は JSON 行。クライアントは解決後の設定、
ファイル中の何件のうち何件を読み込んだか、そして全リクエストが受理された時点の
サマリを出力する。

### オプション

フラグは `src/cli/client-cli.ts` で定義されている。`--data` は必須で、
**キャプチャ形式も少なくとも 1 つ**必須 — 1 つも無いリクエストはサーバが弾く
(`validateCaptureFormats`)。

| フラグ | 用途 |
|---|---|
| `--data <path>` | YAML データファイル。**必須。** |
| `--server <url>` | サーバのベース URL。環境変数: `BROWSERHIVE_SERVER`。 |
| `--limit <n>` | ファイルから最大 `n` 件だけ読む。 |
| `--png` `--webp` | スクリーンショット。 |
| `--html` | JavaScript 実行後の DOM スナップショット。 |
| `--links` | `<a href>` を抽出して `.links.json` に。 |
| `--mhtml` | 単一ファイルの MHTML アーカイブ (CDP `Page.captureSnapshot`)。 |
| `--wacz` | HTTP セッション全体を WACZ として記録 — [再生クイックスタート](/replay-quickstart/)を参照。 |
| `--full-page` | ビューポートではなくドキュメント全高をキャプチャ。 |
| `--viewport-width <px>` `--viewport-height <px>` | リクエスト単位のビューポート。**対で**渡す必要がある。 |
| `--device-scale-factor <n>` | デバイスピクセル比。`2` にすると 2x のレスポンシブ画像候補を拾う。 |
| `--archive-mode <mode>` | `single-pass`(既定) か `multipass` — DPR ごとに 1 パスを 1 つの WACZ にまとめ、ブラウザキャッシュを無効化する。 |
| `--accept-language <bcp47>` | 全エントリで上流に転送する `Accept-Language`。 |
| `--dismiss-banners` | キャプチャ前にバナー / モーダル除去をベストエフォートで実行。 |
| `--operation-delay-ms <ms>` | ブラウザ操作ごとに遅延を入れ、キャプチャを目で追えるようにする。`0` で無効。[開発環境](/development-environment/)を参照。 |
| `--behaviors-version <v>` | どの `examples/behaviors/<v>/` から読むか。既定は `v1.0`。 |
| `--tls-ca-cert <path>` | CA 証明書。指定すると TLS が有効になる。環境変数: `BROWSERHIVE_TLS_CA_CERT`。[TLS 証明書](/tls-certificates/)を参照。 |

リクエスト単位のフラグはいずれも、そのリクエストに限ってサーバの既定値を上書きする。
サーバ全体の設定は[環境変数](/environment-variables/)にある。

## `data-file.ts` — YAML の形式

トップレベルが配列で、各要素が `labels` と `url` を持つマッピング:

```yaml
- labels: [9202, ANAHoldings]
  url: https://www.ana.co.jp/group/

- labels: ["543A", Archion]   # 英数字混在のティッカーはクォートする
  url: https://www.archion.co.jp/
```

`labels` は成果物のファイル名に入る。英数字混在のティッカーをクォートする必要が
あるのはそのためで、クォートしないと YAML は `543A` を文字列、`9202` を数値として
読んでしまう。数値は文字列に変換されるので、呼び出し側が見るのは常に `string[]`。

パーサは**意図的に厳格**で、1 件でも壊れていればパース全体を失敗させ、問題の
インデックスを名指しするエラーを返す。前身は CSV パーサで、壊れた行を黙って捨てて
いたためフィクスチャの腐敗が気付かれずに溜まった。ハードエラーにする方が、
このプロジェクトの他の場所で使っている `Result` ベースのエラー処理
(`src/result.ts`) と揃う。

## `behaviors-loader.ts` — クライアント側の behavior

BrowserHive が既に対応しているホスト向けの behavior は**サーバに同梱**されていて、
クライアント側は何も要らない。このローダは、サーバがまだカバーしていないサイト用。

`examples/behaviors/<version>/<host>/*.js` をディレクトリ名をキーにしたレジストリへ
読み込み、各キャプチャのホストに当てはまるものを選ぶ。まず **FQDN** の
ディレクトリ (`www.apple.com`)、次に**登録可能ドメイン** (`apple.com`、全サブドメインを
カバー) の順に見る。

```
examples/behaviors/
└─ v1.0/                      # ランタイム契約のバージョン。--behaviors-version で選ぶ
   └─ www.apple.com/          # FQDN、または登録可能ドメイン
      └─ tv-gallery.js        # 素の class 式
```

各ファイルは素の JavaScript の class **式** — `export` も名前も無い — で、そのまま
リクエストの `behaviors.custom[].source` として送られ、`register(<source>)` として
注入される。ローダが生成する id は `"<dir>:<basename>"` で、これはクラスの
`static id` と**一致していなければならない**。ランナーは有効な id と登録済みクラスを
そのフィールドで突き合わせるため。つまり `www.apple.com/tv-gallery.js` は
`static id = "www.apple.com:tv-gallery"` を宣言する必要がある。

これらのファイルは DOM のグローバルを参照しページ内で動くので、コンパイル対象の
モジュールではなくテキストテンプレートとして扱われ、tsc と ESLint の両方から
除外されている。

サーバがカスタム behavior を受け付けるのは `--allow-custom-behaviors` 付きで
起動したときだけ。クラスが実装すべきもの、`ctx` が提供するもの、結果の
`behaviorReport` の読み方は[Behaviors](/behaviors/)にある。

パス中の `v1.0` は behavior 自身のバージョンではなく**ランタイム契約**の
バージョンで、`ctx.Lib` の API と `static id` / `isMatch` / `async *run` の形を
固定している。契約に破壊的変更が入れば新しいディレクトリになり、古い方の
behavior はそのまま動き続ける。

## `data/` — フィクスチャ

リポジトリには 4 つのデータファイルが入っていて、それぞれ役割が違う:

| ファイル | 件数 | 何のためか |
|---|---|---|
| `data/smoke-test.yaml` | 約 51 | 主要グローバルブランド — 高速で結果が読める 200 系。パイプラインが端から端まで繋がっていることの確認用。 |
| `data/nikkei225.yaml` | 225 | 日経 225 構成銘柄の企業トップページ全部。高速なページ・リダイレクト連鎖・バナーの多いページ・稀な 4xx/5xx が現実的に混ざっており、負荷下で並行処理・リトライ・エラー経路を動かすために使う。 |
| `data/accept-language.yaml` | 約 14 | 上記から手で選んだ部分集合で、`ja` と `en` で応答が変わるページ。`--accept-language` のフィクスチャ。 |
| `data/js-redirect.yaml` | 約 6 | `DOMContentLoaded` の直後に JavaScript で遷移する URL 群。`src/capture/page-capturer.ts` の `runOnStableContext` の回帰フィクスチャ。 |

まずは `smoke-test.yaml` と `--limit` から始め、実際に負荷をかけたくなったら
`nikkei225.yaml` に手を伸ばす。
