---
title: テストの実行
description: 2 つの Vitest プロジェクトとその動かし方 — unit テスト・実スタックに対するブラックボックス E2E・@vitest/ui のレポート・CI が回すもの
---

テストは **2 つの Vitest プロジェクト**に分かれている。どのコマンドが何をする
かはこの分割で決まるので、まずここを押さえる:

| プロジェクト | 中身 | スタックの起動が必要か |
|---|---|---|
| `unit` | `test/` 配下すべて（`test/e2e/**` を除く）。高速・インプロセス。 | 不要 |
| `e2e` | `test/e2e/**/*.e2e.test.ts`。ブラックボックスで、HTTP 越しにしかスタックと話さない。 | **必要** |

`pnpm test` は `unit` **だけ**を走らせる。E2E が事故で収集されることはないので、
コンテナを起動し忘れたせいで `pnpm test` が落ちることはない。

## コマンド

| コマンド | プロジェクト | 出力 |
|---|---|---|
| `pnpm test` | unit | ターミナル |
| `pnpm run test:e2e` | e2e | ターミナル |
| `pnpm run test:all` | 両方 | ターミナル |
| `pnpm run test:ui` | unit | 対話的な UI |
| `pnpm run test:ui:e2e` | e2e | 対話的な UI |
| `pnpm run test:report` | unit | `html/` に静的 HTML |
| `pnpm run test:report:e2e` | e2e | `html-e2e/` に静的 HTML |

`unit` 側のコマンドには `pre*` フックが付いていて `prep`（OpenAPI のコード生成 +
ビルド指紋）を先に走らせるので、生成された TypeScript は常に最新になる。e2e 側に
フックを付けていないのは意図的で、HTTP 越しにスタックと話すだけで生成コードを
import しないため、`prep` は無駄な作業になる。

## unit テスト

```sh
pnpm test
```

他に必要なものは無い。範囲を絞るならファイル名や名前パターンをそのまま渡す:

```sh
pnpm exec vitest run --project unit test/storage/wacz
pnpm exec vitest run --project unit -t "retries"
```

## E2E テスト

実 Chromium で実際にページを収集し、フィクスチャ origin が何を観測したかで
assert するので、先にスタックを上げる必要がある:

```sh title="このマシンで 1 回だけ — プロジェクト名の DNS ドメイン"
sudo container system dns create browserhive
```

```sh title="SeaweedFS + Chromium ワーカー + サーバ + meadow を起動"
container-compose --profile meadow up -d -b
```

```sh
pnpm run test:e2e
```

```sh title="終わったら — up で使った --profile を同じように渡す"
container-compose --profile meadow down
```

`container-compose` は readiness を提供しないので、待つのはスイート自身の役目に
なっている。`test/e2e/global-setup.ts` が `/v1/status` を 1 秒間隔で 45 秒
ポーリングし、それでも駄目なら skip ではなく**大きな声で失敗**して、何を起動
すべきかを示す:

```
E2E stack not reachable at http://localhost:8080 after 45s —
bring it up first: container-compose --profile meadow up -d -b
```

黙って skip すると「通った」と見分けが付かなくなる。それを避けるための設計。

エンドポイントは意図的に固定してある。API は localhost に publish され、
フィクスチャ origin はプラットフォームの DNS 名で解決する。どちらもホストからも
Chromium ワーカーからも引けるので、配線は静的で済む。別の場所を指したいときは
`E2E_API_URL` と `E2E_MEADOW_URL` を使う。

フィクスチャ origin は [meadow](https://uraitakahito.github.io/meadow/ja/) で、
ワークスペースメンバーなので `pnpm install` はリンクを張るだけ。`dist/` は
スイートが必要になった時点で `pnpm run test:e2e` がビルドする。先に用意したければ
`pnpm --filter meadow build` を手で叩く。各ルートが何を再現するかは
[Scenarios のページ](https://uraitakahito.github.io/meadow/ja/scenarios/)にある。
この周辺の開発ループ — 同じコンテナ群に対してホスト上で作業中のサーバを動かす —
については[開発環境](/development-environment/)を参照。

### テストが落ちたとき

既定のレポータは、失敗の下にサーバ自身のキャプチャ判定を出す — `taskId`、
キャプチャが成功したか、何回リトライされたか、成果物がどこに落ちたか:

```
× flaky(2): browserhive retries via real Chrome and succeeds on the 3rd hit
   ↳ taskId=2805f4ac-… url=http://meadow.browserhive:8080/flaky?fail=2&key=e2e
   ↳ status=success retryCount=2
   ↳ {"html":"s3://browserhive/2805f4ac-…_e2e.html"}

AssertionError: expected 3 to be 99
```

assert はフィクスチャ origin のヒットカウンタについてのものなので、失敗したとき
最初に知りたいのは「そもそもキャプチャは成功したのか」になる。上の行がサーバの
ログを開かずにそれに答える。しかも `taskId` は待機を始める**前**に注釈されるので
タイムアウトしても残る — `container logs browserhive.browserhive` でタスクを探す
必要があるのは、まさにそのときだ。これらはすべて
`test/e2e/helpers/capture.ts` の `annotate()` 呼び出しから来ている。

成功した実行では何も出ない。それでも見たい場合は `--reporter=verbose` を付ける:

```sh
pnpm exec vitest run --project e2e --reporter=verbose
```

## UI

`@vitest/ui` は同じ画面を対話的にも静的バンドルとしても提供する。主に効くのは
E2E スイートで、上の注釈があるのはそこだけだから:

```sh
pnpm run test:ui:e2e
```

ログに流れる行の代わりに、UI はそれを **Test Annotations** パネルとして
type・メッセージ・発生位置に分けてまとめ、**Code** タブでは注釈を生んだ
`annotate()` の行にそれぞれインライン展開する。観測結果を、それを作ったコードの
隣で読めるということ:

```
Test Annotations
  capture     taskId=156536c8-… url=http://meadow.browserhive:8080/flaky?fail=2&key=e2e
  capture     status=success retryCount=2
  artifacts   {"html":"s3://browserhive/156536c8-…_e2e.html"}
```

既定のレポータと違い、テストが通ったか落ちたかに関係なく表示される —
`--reporter=verbose` は要らない。

`test:ui` は意図的に `unit` プロジェクトに限定してある。プロジェクトを絞らないと
Vitest は `e2e` も収集し、その global setup が 45 秒待って throw するので、
スタックが上がっていない限り絞らない UI は使えない。

ツリー以外に、UI は状態フィルタ（`Fail` / `Pass` / `Skip` / `Only Tests` /
`Slow`）、プロジェクト切り替え、そして検索ボックスを持つ。検索ボックスは config に
tags を宣言していれば `tag:<式>` も受け付ける。

## 静的レポート

```sh
pnpm run test:report:e2e
```

レポートは Vite アプリケーションで、データを実行時に fetch する。したがって
**`file://` では動かない**。サーバ経由で開く:

```sh
npx vite preview --outDir html-e2e
```

出力先（`html/`・`html-e2e/`）はどちらも gitignore 済みで、ESLint からも除外して
ある — バンドル済みのレポートはどの TypeScript プロジェクトにも属さない。

なおレポートは、**収集したテストファイルのソースを全文埋め込む**。失敗の有無に
関係なく入る。このリポジトリのテストはもとから公開なので特筆すべきことではないが、
この構成を非公開リポジトリに持ち込む前には知っておく価値がある。

## CI が回すもの

| ワークフロー | 発火条件 | 実行内容 |
|---|---|---|
| `ci.yml` | 全 PR と `main`/`develop` への push | ビルド・examples ビルド・ESLint・**unit** テスト |
| `e2e.yml` | 手動 dispatch のみ | self-hosted macOS ランナー上で **e2e** スイート |

E2E を PR ごとの経路から外しているのは、Apple Container が GitHub ホストの Linux
では動かず、かつ高速な unit ゲートが既に全 PR を見ているため。

dispatch した E2E 実行は、レポートを **`e2e-report`** という名前の artifact として
アップロードする。実行のサマリページからダウンロードしてサーバ経由で開く —
上記の `file://` の注意はダウンロードしたものにも当てはまる:

```sh
npx vite preview --outDir e2e-report
```

実行ステップは失敗してもアップロードを止めないようにしてあり、失敗はその後で
再度立てられる。赤いスイートでも読めるレポートが残る。
