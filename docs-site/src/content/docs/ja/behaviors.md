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
