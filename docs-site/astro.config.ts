import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import remarkCodeRegion from "./src/plugins/remark-code-region";

const BASE = "/browserhive";

// Rehype plugin: markdown content 内の絶対ローカルリンク (/page/) に base を付与し、
// /ja/ 配下のページからのリンクには /ja ロケールも注入する(chromium-server-docker と
// 同一の実装)。Starlight のサイドバー/ナビは slug 経由で base/locale-aware だが、
// MDX/MD 本文に書かれた [text](/page/) は素通しになるため、rehype 段で補正する。
// アセット(最終セグメントに拡張子を持つ href)は base のみ付与する。
// フロントマター (hero.actions.link 等) はこの pipeline を通らないので
// そちらは /browserhive/page/ (ja 版は /browserhive/ja/page/) と直接書く。
// Starlight が既に base-aware なリンクを出力している場合は二重付与しない。
function rehypeRebaseLinks() {
  return function (tree: any, file: any): void {
    const path: string = file?.path ?? file?.history?.[0] ?? "";
    const inJa = /[\\/]docs[\\/]ja[\\/]/.test(path);
    const walk = (node: any): void => {
      if (
        node.type === "element" &&
        node.tagName === "a" &&
        typeof node.properties?.href === "string"
      ) {
        const href: string = node.properties.href;
        // 既に base が付いているリンクは触らない
        if (
          href.startsWith("/") &&
          !href.startsWith("//") &&
          !href.startsWith(BASE + "/") &&
          href !== BASE
        ) {
          const lastSeg = href.split(/[?#]/)[0].split("/").pop() ?? "";
          const isAsset = lastSeg.includes(".");
          // /api/ は Starlight ロケール外(Redoc をデプロイ時に注入)なので
          // /ja を付けない — /ja/api/ は存在しない。
          const isApi = href === "/api" || href.startsWith("/api/");
          const locale =
            inJa && !isAsset && !isApi && !href.startsWith("/ja/") && href !== "/ja"
              ? "/ja"
              : "";
          node.properties.href = BASE + locale + href;
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

// BrowserHive ドキュメントサイト。MDX に自由記述、用語集/型/コード片は
// docs-site/src/lib/extract.ts でコードから注入する(案B)。
export default defineConfig({
  site: "https://uraitakahito.github.io",
  base: BASE,
  integrations: [
    // ```mermaid をクライアントサイドで描画(playwright 不要)。starlight より前に置く。
    mermaid({ theme: "neutral" }),
    starlight({
      title: "BrowserHive Docs",
      // リファレンス表のセル内コードを 1 行に保つ(長い CLI フラグが 2 行に割れて
      // 読みにくくなるのを防ぐ。収まらない幅では Starlight 既定の overflow で横スクロール)
      customCss: ["./src/styles/tables.css"],
      // i18n: English = root locale (no prefix) / Japanese = ja (/ja/ prefix).
      // Same layout as chromium-server-docker; untranslated ja pages fall
      // back to English automatically.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      // Every entry carries a `ja` translation. Starlight localises the pages
      // but not the nav, so without these a Japanese reader gets a fully
      // translated page hanging off an English label — and has to guess which
      // of nine "For developers" entries is the one about tests.
      sidebar: [
        { label: "Quickstart", translations: { ja: "クイックスタート" }, slug: "quickstart" },
        {
          label: "Guides",
          translations: { ja: "ガイド" },
          items: [
            {
              label: "Development environment",
              translations: { ja: "開発環境" },
              slug: "development-environment",
            },
            {
              label: "Environment variables",
              translations: { ja: "環境変数" },
              slug: "environment-variables",
            },
            { label: "Behaviors", translations: { ja: "Behavior（挙動）" }, slug: "behaviors" },
            {
              label: "Capture results",
              translations: { ja: "キャプチャ結果" },
              slug: "capture-results",
            },
            { label: "Storage", translations: { ja: "ストレージ" }, slug: "storage" },
            {
              label: "TLS certificates",
              translations: { ja: "TLS 証明書" },
              slug: "tls-certificates",
            },
            {
              label: "Replay quickstart",
              translations: { ja: "Replay クイックスタート" },
              slug: "replay-quickstart",
            },
            {
              label: "Signing a WACZ",
              translations: { ja: "WACZ に署名する" },
              slug: "signing",
            },
            {
              label: "Archives as evidence",
              translations: { ja: "証拠としてのアーカイブ" },
              slug: "evidence",
            },
            {
              label: "Related projects",
              translations: { ja: "関連プロジェクト" },
              slug: "related-projects",
            },
            {
              label: "Specifications",
              translations: { ja: "仕様書リンク集" },
              slug: "specifications",
            },
          ],
        },
        {
          label: "For developers",
          translations: { ja: "開発者向け" },
          items: [
            { label: "Architecture", translations: { ja: "アーキテクチャ" }, slug: "architecture" },
            {
              label: "Running the tests",
              translations: { ja: "テストの実行" },
              slug: "running-tests",
            },
            { label: "Examples", translations: { ja: "examples" }, slug: "examples" },
            { label: "XState primer", translations: { ja: "XState 入門" }, slug: "xstate-primer" },
            {
              label: "Worker spawn & loop",
              translations: { ja: "ワーカーの生成とループ" },
              slug: "worker-spawn-and-loop",
            },
            { label: "Terminology", translations: { ja: "用語集" }, slug: "terminology" },
            {
              label: "Glossary reference",
              translations: { ja: "用語リファレンス" },
              slug: "glossary-reference",
            },
            {
              label: "WACZ vocabulary",
              translations: { ja: "WACZ 用語の使い分け" },
              slug: "wacz-vocabulary",
            },
            {
              label: "WACZ internals",
              translations: { ja: "WACZ internals" },
              slug: "wacz-internals",
            },
            {
              label: "Spec coverage",
              translations: { ja: "仕様の実装状況" },
              slug: "spec-coverage",
            },
          ],
        },
        {
          // Absolute URL on purpose: /api/ is the Redoc reference injected
          // outside Starlight at deploy time, so it is not a Starlight route.
          // A root-relative "/api/" would be locale-prefixed to
          // "/ja/api/" (a 404) on Japanese pages; an absolute URL is left
          // untouched. It also has no page in a local `astro build`.
          label: "API reference ↗",
          translations: { ja: "API リファレンス ↗" },
          link: "https://uraitakahito.github.io/browserhive/api/",
        },
      ],
    }),
  ],
  // ```ts file="src/…#region" を実ソースに差し替える(コード片を live 化)
  // rehypeRebaseLinks: MDX/MD 本文内の /page/ リンクに base を付与
  markdown: {
    remarkPlugins: [remarkCodeRegion],
    rehypePlugins: [rehypeRebaseLinks],
  },
});
