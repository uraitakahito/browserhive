import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import remarkCodeRegion from "./src/plugins/remark-code-region";

// BrowserHive ドキュメントサイト。MDX に自由記述、用語集/型/コード片は
// docs-site/src/lib/extract.ts でコードから注入する(案B)。
export default defineConfig({
  integrations: [
    // ```mermaid をクライアントサイドで描画(playwright 不要)。starlight より前に置く。
    mermaid({ theme: "neutral" }),
    starlight({
      title: "BrowserHive Docs",
      defaultLocale: "ja",
      locales: { root: { label: "日本語", lang: "ja" } },
    }),
  ],
  // ```ts file="src/…#region" を実ソースに差し替える(コード片を live 化)
  markdown: { remarkPlugins: [remarkCodeRegion] },
});
