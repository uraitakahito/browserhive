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
          const locale =
            inJa && !isAsset && !href.startsWith("/ja/") && href !== "/ja" ? "/ja" : "";
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
      // i18n: English = root locale (no prefix) / Japanese = ja (/ja/ prefix).
      // Same layout as chromium-server-docker; untranslated ja pages fall
      // back to English automatically.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      sidebar: [
        { label: "Quickstart", slug: "quickstart" },
        {
          label: "For developers",
          items: [
            { label: "Architecture", slug: "architecture" },
            { label: "XState primer", slug: "xstate-primer" },
            { label: "Worker spawn & loop", slug: "worker-spawn-and-loop" },
            { label: "Terminology", slug: "terminology" },
            { label: "Glossary reference", slug: "glossary-reference" },
            { label: "WACZ vocabulary", slug: "wacz-vocabulary" },
          ],
        },
        {
          label: "API reference ↗",
          link: "/api/",
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
