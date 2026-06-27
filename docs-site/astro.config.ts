import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import remarkCodeRegion from "./src/plugins/remark-code-region";

const BASE = "/browserhive";

// Rehype plugin: markdown content 内の絶対ローカルリンク (/page/) に base を付与する。
// Starlight のサイドバー/ナビは slug 経由で base-aware だが、
// MDX/MD 本文に書かれた [text](/page/) は素通しになるため、rehype 段で補正する。
// フロントマター (hero.actions.link 等) はこの pipeline を通らないので
// そちらは /browserhive/page/ と直接書く。
// Starlight が既に base-aware なリンクを出力している場合は二重付与しない。
function rehypeRebaseLinks() {
  return function (tree: any): void {
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
          node.properties.href = BASE + href;
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
      defaultLocale: "ja",
      locales: { root: { label: "日本語", lang: "ja" } },
      sidebar: [
        { label: "クイックスタート", slug: "quickstart" },
        {
          label: "開発者向け",
          items: [
            { label: "アーキテクチャ解説", slug: "architecture" },
            { label: "XState 入門", slug: "xstate-primer" },
            { label: "ワーカーの生成とループ", slug: "worker-spawn-and-loop" },
            { label: "用語集", slug: "terminology" },
            { label: "用語リファレンス", slug: "glossary-reference" },
            { label: "WACZ 語彙", slug: "wacz-vocabulary" },
          ],
        },
        {
          label: "API リファレンス ↗",
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
