---
title: Behavior（挙動）
description: キャプチャ中にページへ注入する自動操作スクリプト — 組み込みの autoscroll / autofetch / autoplay、リクエスト単位の調整、クライアント提供のカスタム behavior
---

**Behavior** は、BrowserHive が各キャプチャページに注入する小さな自動操作スクリプト。
スクロール・再生・クリックしないと読み込まれない資源をアーカイブに残すためのもの。
ランタイム（`src/behaviors/runtime/`）は 1 本のスクリプトにバンドルされて注入され、
各 behavior は**非同期ジェネレータ**として `yield` ごとに進み、全体は
`--behavior-timeout` で打ち切られる（worker がハングしない）。

## 組み込み behavior

**フラグ／設定だけで有効化でき、クライアント側の JavaScript は不要。**

| id | 既定 | 何をするか |
|----|------|-----------|
| `autoscroll` | **on** | 全高までスクロールし、`loading="lazy"` / IntersectionObserver / `data-src` を発火させて資源を記録。スクリーンショット用に最上部へ戻す。 |
| `autofetch` | **on** | `srcset` の**全候補**（1x/2x・小中大）、`data-*` 遅延属性、同一オリジンの stylesheet `url(...)` を能動的に fetch。キャプチャ時のビューポート/DPR が選ばなかった候補も取得し、**再生を DPR/ビューポート完全**にする（Retina の `_2x` 欠落を解消）。 |
| `autoplay` | off（opt-in） | `<video>` / `<audio>` をミュート再生し、`src` / `<source>` / `poster` を fetch してメディアをアーカイブ。大きくなり得る。 |

既定の有効セットは `autoscroll,autofetch`。behavior は記載順に実行される。

## サイト別 behavior（サーバ同梱）

一部のサイトは、組み込み behavior だけでは取りこぼす作りをしている。BrowserHive は
そうしたサイト向けの behavior を**ランタイムに同梱**しており、**クライアントは何も
送らなくてよい**（`behaviors.custom` も `--allow-custom-behaviors` も不要）。

| id | 対象 | 何をするか |
|----|------|-----------|
| `site:apple.com/gallery-variants` | `*.apple.com` | TV+ ギャラリーのスライドは `srcset` を持たず URL を DPR から計算するため、撮影した DPR の変種しか録れない。SSR HTML と live DOM から mzstatic の画像 URL を集め、**2 倍・1/2 のきょうだい URL も取得**して変種を埋める。 |

- **組み込み built-in とは有効化の仕方が違う**: `--behaviors` に id を書く必要はなく、
  **常に候補**に入る。実際に走るかは各 behavior の `isMatch()`（ホスト判定）が決めるので、
  **対象外のサイトでは一切動かない**。
- 実行順は**組み込み built-in の後**（`autoscroll` / `autofetch` がページを整えた後に効かせるため）。
- 走ったかどうかは `behaviorReport.ran[].id` で分かる（`site:` 接頭辞が目印）。
- 止めたいときはサーバを `--no-site-behaviors`（`BROWSERHIVE_SITE_BEHAVIORS=false`）で起動するか、
  リクエストで `"behaviors": { "siteBehaviors": false }` を指定する。比較検証や、
  過去のアーカイブを再現したいときに使う。

## behavior を有効にする

### サーバ全体（フラグ／env）

```sh
node dist/bin/main.js server \
  --behaviors autoscroll,autofetch,autoplay \  # 記載順 = 実行順。"" で全 OFF
  --behavior-timeout 30000                     # 全体の上限(ms)
# env: BROWSERHIVE_BEHAVIORS / BROWSERHIVE_BEHAVIOR_TIMEOUT_MS
```

フラグ ↔ env の全対応は[環境変数](/environment-variables/)を参照。

### リクエスト単位

`POST /v1/captures` の body は `behaviors` オブジェクトを受け付ける。`builtins` は
そのキャプチャに限りサーバ既定セットを置き換え、`options` は behavior id ごとに
サーバ設定へマージされる。

```json
{
  "url": "https://www.apple.com/",
  "captureFormats": { "wacz": true },
  "behaviors": {
    "builtins": ["autoscroll", "autofetch"],
    "options": { "autoscroll": { "maxSteps": 60 } }
  }
}
```

## カスタム behavior

クライアントは JavaScript を送るだけで任意の自動操作を追加できる（サーバ改修不要）。
各カスタム behavior は interface を実装した**クラス式**で、`behaviors.custom` に渡す。
**サイト固有**の自動化もこれで行える — `isMatch()` を hostname で判定すればよい。

```json
{
  "url": "https://example.com/feed",
  "captureFormats": { "wacz": true },
  "behaviors": {
    "custom": [
      {
        "id": "loadMore",
        "source": "class { static id='loadMore'; static isMatch(){ return location.hostname === 'example.com'; } async *run(ctx){ let b; while ((b = document.querySelector('button.more'))) { b.click(); await ctx.Lib.sleep(1500); yield ctx.getState('clicked','clicks'); } } }"
      }
    ]
  }
}
```

behavior のインターフェース（ブラウザ側）:

```ts
class MyBehavior {
  static id = "myBehavior";
  static isMatch(): boolean { /* このページで動かすか（URL / DOM） */ return true; }
  async *run(ctx: BehaviorCtx) {
    // ctx.Lib: sleep, collectCandidateUrls, collectStyleSheetUrls, scrollIntoView
    // ctx.opts: behavior 別の設定 / ctx.getState(msg, counter): yield チェックポイント
    yield ctx.getState("step 1");
  }
}
```

:::caution
カスタム behavior は**キャプチャ用ブラウザで動く任意コード**なので、**既定では無効**。
受け入れるにはサーバを `--allow-custom-behaviors`
（`BROWSERHIVE_ALLOW_CUSTOM_BEHAVIORS=true`）で起動する。無効時は `custom` は無視される。
behavior はページ内で `fetch()` でき、キャプチャブラウザが到達できる先へ到達し得る —
egress はネットワーク境界で縛り、有効化は「クライアントにコード実行を許すこと」と捉える。
:::

### サイト（FQDN/ドメイン）ごとに整理する（サンプルクライアント）

同梱のサンプルクライアント（`examples/data-client.ts`）は、カスタム behavior を
**1 サイト = 1 ディレクトリ**でディスク上に置き、取得先 URL のホストに応じて
自動で添付する。多くのサイト固有 automation は、ファイルを置くだけで済み、
リクエスト側の記述は要らない:

```
examples/behaviors/
└─ <version>/                    # ランタイム契約のバージョン（例 v1.0）
   ├─ www.apple.com/             # FQDN — 最も具体的
   │  └─ tv-gallery.js
   └─ apple.com/                 # 登録可能ドメイン — 全サブドメイン
      └─ promo-carousel.js
```

各 `<name>.js` は上と同じ形の**素の class 式**。規約として `static id` は
`"<dir>:<basename>"`（例 `www.apple.com:tv-gallery`）と一致させる — クライアントは
その id を送り、runner は enabled の id と登録クラスを `static id` で突き合わせる。

バージョンディレクトリは `--behaviors-version`（既定 `v1.0`）で選ぶ。エントリごとに
FQDN ディレクトリ → 登録可能ドメインディレクトリの順で読み、`behaviors.custom` として送る:

```sh
# サーバはカスタム behavior を許可して起動
node dist/bin/main.js server --allow-custom-behaviors
# クライアントは base URL を --server / BROWSERHIVE_SERVER / SDK 既定 から解決し
#（URL のハードコードなし）、ホストに応じて behavior を添付する
node dist/examples/data-client.js --data data/apple.yaml --wacz --behaviors-version v1.0
```

送るのは `custom` のみで `builtins` は送らない: 組み込みセット（`autoscroll`・
`autofetch` 等）はサーバ自身の `--behaviors` 設定に委ね、クライアントが誤って
無効化しないようにする。

:::tip[観察したいとき]
キャプチャが速すぎて描画を追えない場合は、リクエストに `operationDelayMs` を付けると
そのキャプチャだけ 1 操作ずつ遅くなる —— [開発環境](/ja/development-environment/) を参照。
:::

### Retina（2x）忠実度 — DPR 2 で撮る

一部のサイト（例: `apple.com`）は**デバイスピクセル比ごとに 1 変種だけ**を
レンダリングする: スライドの `<img>` に `srcset` は無く、URL を
`window.devicePixelRatio` から決める。既定の DPR-1 撮影では 1x しか取得されず、
Retina 再生が要求する `2x` がアーカイブに無いため画像が黒くなる。

**DPR 2 で撮る**とブラウザ自身が `2x` を取得する:

```sh
node dist/examples/data-client.js --data data/apple.yaml --wacz --device-scale-factor 2
```

HTTP API を直に叩くなら、リクエストに `deviceScaleFactor: 2` を付ける
（WACZ を残すので `captureFormats.wacz` も `true` にする）。
`operationDelayMs` も添えてあるのは、**そうしないとキャプチャが数秒で終わって
`chrome://inspect` で描画を観察できない**ため（観察が不要なら外してよい）:

```bash
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.apple.com/jp/",
    "labels": ["apple-jp"],
    "deviceScaleFactor": 2,
    "operationDelayMs": 250,
    "captureFormats": {
      "png": false, "webp": false, "html": false,
      "links": false, "mhtml": false,
      "wacz": true
    }
  }' | jq .
```

`2x` が実際にアーカイブされたかは、出来上がった WACZ の CDXJ を見れば確認できる
（apple のスライドなら 1x の `980x522` ではなく `1960x1044` が並ぶ）:

```bash
# 成果物キーは <taskId>_<labels>.wacz（correlationId を送った場合はそれも入る）
curl -fsS -o out.wacz \
  "http://seaweedfs.browserhive:8888/buckets/browserhive/92fc7fb0-…_apple-jp.wacz"
unzip -p out.wacz indexes/index.cdxj | grep -o '[0-9]\{3,4\}x[0-9]\{3,4\}' | sort | uniq -c
#   18 1960x1044   ← 2x が入っている（DPR 1 だと 980x522 になる）
```

またはサーバ既定を `BROWSERHIVE_DEVICE_SCALE_FACTOR=2` /
`--device-scale-factor 2` にする。DPR 2 では PNG / WebP スクリーンショットの画素
寸法も 2 倍になる点に注意。

### 1x と 2x の両方を 1 つの WACZ に — `archiveMode: multipass`

各変種は DPR 固有でハイドレーション後に DOM から消えるため、**1 パスでは
1x と 2x の両方を保持できない**（DPR 2 で撮れば 2x のみ、DPR 1 なら 1x のみ）。
両方必要なら `archiveMode` を `multipass` にする —— 同じページを **DPR 1 と 2 で
1 回ずつ読み込み、1 つの WACZ にまとめる**:

```bash
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.apple.com/jp/",
    "labels": ["apple-jp"],
    "archiveMode": "multipass",
    "captureFormats": {
      "png": false, "webp": false, "html": false,
      "links": false, "mhtml": false, "wacz": true
    }
  }' | jq .
```

各パスは**ブラウザキャッシュを使わず**取得する（キャッシュ済みの応答で済ませては
複数パスの意味がなく、再検証の `304` は本文を持たないためアーカイブに穴が空く）。

実測（apple.com/jp）: single-pass は `1960x1044` ×9 のみ、**multipass は
`980x522` ×9 と `1960x1044` ×9 の両方**。代償として記録数 409→751、
容量 77MB→123MB とほぼ 2 倍になり、所要時間も約 2 倍。
`deviceScaleFactor` は無視され（モードが自前で DPR を切り替えるため）、
PNG / WebP は最後のパス（DPR 2）の状態で撮られる。

サーバ既定は `--archive-mode multipass` / `BROWSERHIVE_ARCHIVE_MODE=multipass`。
`srcset` で候補を宣言するサイトは `autofetch` が 1 パスで両変種を取得済みなので、
multipass が要るのは **URL を DPR から計算する型のサイト**だけ。

## behavior レポート

behavior が 1 つでも実行されると、完了タスクのサーバログ行に `behaviorReport` が入る:

```json
{
  "msg": "Task completed",
  "url": "https://www.apple.com/",
  "behaviorReport": {
    "ran": [
      { "id": "autoscroll", "steps": 9, "ms": 3025 },
      { "id": "autofetch",  "steps": 29, "ms": 201 }
    ],
    "timedOut": false
  }
}
```

- `ran` — 実際に走った behavior（有効 ∩ `isMatch`）を実行順に。各 `steps`（yield 回数）・
  実時間 `ms`・throw 時は `error` 文字列。
- `timedOut` — `--behavior-timeout` に達して残りの behavior をスキップした場合 `true`。
