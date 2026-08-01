/**
 * Renders `spec-coverage.md` (en + ja) from `spec-coverage-data.ts`, and checks
 * the table against the code it describes.
 *
 * A page that lists what the implementation covers is worth having only while
 * it is true, and the way it stops being true is mundane: someone adds a field
 * and does not think to open a docs page. So the page is generated, and the
 * generator refuses to agree with a table that has drifted.
 *
 * `BROWSERHIVE_DOCS_CHECK=1` compares instead of writing — the CI form. Same as
 * waxlens' corpus docs, which this follows.
 */
import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COVERAGE, type CoverageArea, type CoverageState } from "./spec-coverage-data.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = resolve(ROOT, "docs-site", "src", "content", "docs");
const checkMode = process.env["BROWSERHIVE_DOCS_CHECK"] === "1";

const LABEL: Record<CoverageState, { en: string; ja: string }> = {
  implemented: { en: "Implemented", ja: "実装" },
  "implemented-plus": { en: "Implemented + supplemented", ja: "実装＋補完" },
  unused: { en: "Not used", ja: "未実装" },
  divergent: { en: "Divergent", ja: "逸脱" },
};

const count = (area: CoverageArea, ...states: CoverageState[]): number =>
  area.items.filter((i) => states.includes(i.state)).length;

/** Items the spec defines — a non-spec extension is not part of the denominator. */
const specItems = (area: CoverageArea): number =>
  area.items.filter((i) => !i.item.includes("non-spec")).length;

const table = (area: CoverageArea, lang: "en" | "ja"): string => {
  const head =
    lang === "en"
      ? "| Item | State | Notes |\n| --- | --- | --- |"
      : "| 項目 | 状態 | 備考 |\n| --- | --- | --- |";
  const rows = area.items.map(
    (i) => `| \`${i.item}\` | ${LABEL[i.state][lang]} | ${i[lang]} |`,
  );
  return [head, ...rows].join("\n");
};

const render = (lang: "en" | "ja"): string => {
  const totals = COVERAGE.map((a) => {
    const done = count(a, "implemented", "implemented-plus");
    return `| ${lang === "en" ? a.titleEn : a.titleJa} | ${String(done)} / ${String(specItems(a))} |`;
  }).join("\n");

  const intro =
    lang === "en"
      ? `---
title: Spec coverage
description: Which parts of WARC, WACZ, CDXJ and wacz-auth BrowserHive implements — and which it does not, with the reason
---

BrowserHive writes to four specifications. This page says what it emits of each
one, what it leaves out, and where it knowingly does something else.

The distinction that matters is between **not used** and **divergent**. Leaving a
field out is a scope decision; taking a different route where the spec offers one
is a trade-off someone made, and the reason belongs in writing.

:::note
Generated from \`test/docs/spec-coverage-data.ts\`. Editing this file directly will
be overwritten — and CI checks that the table still matches the code.
:::

## Summary

| Surface | Covered |
| --- | --- |
${totals}

"Covered" counts implemented and implemented-plus. Non-spec extensions are
listed but excluded from the denominator.
`
      : `---
title: 仕様の実装状況
description: WARC・WACZ・CDXJ・wacz-auth のうち BrowserHive が実装している範囲と、していない範囲およびその理由
---

BrowserHive は 4 つの仕様に対して書き出しています。このページは、それぞれについて
何を出しているか、何を出していないか、どこで意図的に別の方法を採ったかを述べます。

重要なのは**未実装**と**逸脱**の区別です。フィールドを出さないのは範囲の判断ですが、
仕様が手段を用意しているのに別の道を採ったのなら、それは誰かが行った取捨選択であり、
理由を書き残す価値があります。

:::note
\`test/docs/spec-coverage-data.ts\` から生成しています。このファイルを直接編集しても
上書きされます。表がコードと合っているかは CI が検査します。
:::

## 概要

| 面 | 被覆 |
| --- | --- |
${totals}

「被覆」は実装と実装＋補完の合計です。仕様外の拡張は一覧に載せますが分母から外しています。
`;

  const sections = COVERAGE.map((a) => {
    const title = lang === "en" ? a.titleEn : a.titleJa;
    const spec = lang === "en" ? a.specEn : a.specJa;
    const label = lang === "en" ? "Defined by" : "定義元";
    return `## ${title}\n\n${label}: ${spec}\n\n${table(a, lang)}\n`;
  }).join("\n");

  const outro =
    lang === "en"
      ? `\n## Deliberately out of scope

Things a capture never tries to hold, as opposed to fields it does not emit:

- **Authentication flows, live data, WebRTC** — see [Replay quickstart](/replay-quickstart/).
- **The captured page's own service worker** — replay installs its own, and the
  captured one fights it.
- **Bodies over \`maxResponseBytes\`** — recorded as a truncation, and the capture
  reports itself incomplete.
- **Traffic matching the default block list** (\`google-analytics.com\` and friends)
  — nothing is recorded at all.

## Related

- [WACZ internals](/wacz-internals/) — how the encoding works, and the replay
  gotchas found by debugging it.
- [WACZ vocabulary](/wacz-vocabulary/) — which words to use when writing about
  this output.
`
      : `\n## 意図的に対象外にしているもの

出していないフィールドとは別に、そもそもキャプチャが保持しようとしないものです。

- **認証フロー / ライブデータ / WebRTC** — [Replay クイックスタート](/replay-quickstart/)を参照。
- **キャプチャ対象ページの Service Worker** — replay は自前の SW を使うため、
  キャプチャした SW は競合する。
- **\`maxResponseBytes\` を超える本文** — 切り詰めとして記録し、
  キャプチャは自身を不完全として報告する。
- **既定ブロックリストに一致する通信**（\`google-analytics.com\` 等）— 何も記録しない。

## 関連

- [WACZ internals](/wacz-internals/) — エンコードの仕組みと、デバッグで判明した replay の落とし穴。
- [WACZ 用語の使い分け](/wacz-vocabulary/) — この出力について書くときの語彙。
`;

  return `${intro}\n${sections}${outro}`;
};

describe("spec coverage page", () => {
  it("matches the committed docs", async () => {
    for (const [lang, path] of [
      ["en", resolve(DOCS, "spec-coverage.md")],
      ["ja", resolve(DOCS, "ja", "spec-coverage.md")],
    ] as const) {
      const next = render(lang);
      if (checkMode) {
        const current = await readFile(path, "utf8");
        expect(current, `${path} is stale — run \`pnpm run docs:spec-coverage\``).toBe(next);
      } else {
        await writeFile(path, next, "utf8");
      }
    }
  });

  /**
   * The check that gives the page its value.
   *
   * Rendering a table proves nothing about whether the table is right. This
   * reads the WARC header names the builders actually write and requires the
   * table's `implemented` claims to be exactly that set — so adding a field
   * without listing it fails, and listing one that is not emitted fails too.
   */
  it("claims exactly the WARC fields the builders emit", async () => {
    const builders = await readFile(resolve(ROOT, "src", "storage", "warc", "builders.ts"), "utf8");
    // Both forms the builders use: object-literal keys and `headers[...] =`.
    // Double-quoted only — prose in the doc comments writes these names in
    // backticks, so it cannot be mistaken for an emitted field.
    const emitted = new Set([...builders.matchAll(/"(WARC-[A-Za-z-]+)"/g)].map((m) => m[1]!));

    const area = COVERAGE.find((a) => a.id === "warc-fields");
    expect(area).toBeDefined();
    const claimed = new Set(
      area!.items
        .filter((i) => i.state === "implemented" || i.state === "implemented-plus")
        .map((i) => i.item)
        // Content-Type / Content-Length are HTTP names the builders set as
        // literals in the object, not through the `headers[...] =` form.
        .filter((name) => name.startsWith("WARC-")),
    );

    expect([...claimed].sort()).toEqual([...emitted].sort());
  });

  /**
   * The ZIP layout — a check that was missing entirely.
   *
   * These claims went unverified, so `datapackage-digest.json` sat marked
   * `unused` and nothing would have noticed once the packager began writing
   * it. A table nobody verifies is worse than no table: it reads as coverage
   * while being free to drift.
   *
   * Plain set equality does not fit here, because `divergent` covers two
   * opposite situations — `fuzzy.json` is written and not in the spec, while
   * `indexes/index.idx` is in the spec and not written. So the invariant is
   * stated in both directions instead:
   *
   *   - everything the packager writes is listed, and not as `unused`;
   *   - nothing claimed `implemented` is a file the packager never writes.
   *
   * The packager names every entry it appends in a `*_ENTRY_PATH` constant,
   * which makes the written set readable without running a capture.
   */
  it("claims exactly the zip entries the packager writes", async () => {
    const packager = await readFile(resolve(ROOT, "src", "storage", "wacz", "packager.ts"), "utf8");
    const written = new Set(
      [...packager.matchAll(/^const \w+_ENTRY_PATH = "([^"]+)";$/gm)].map((m) => m[1]!),
    );
    expect(written.size).toBeGreaterThan(0);

    const area = COVERAGE.find((a) => a.id === "wacz-layout");
    expect(area).toBeDefined();
    // Items annotate the path with a parenthetical ("fuzzy.json (non-spec)").
    const byPath = new Map(
      area!.items.map((i) => [i.item.replace(/\s*\(.*\)$/, ""), i.state] as const),
    );

    for (const path of written) {
      expect(byPath.has(path), `${path} is written but not listed`).toBe(true);
      expect(byPath.get(path), `${path} is written but marked unused`).not.toBe("unused");
    }

    for (const [path, state] of byPath) {
      if (state === "implemented" || state === "implemented-plus") {
        expect(written.has(path), `${path} is claimed implemented but never written`).toBe(true);
      }
    }
  });

  /** Same idea for CDXJ: the required keys the builder writes must be the claimed ones. */
  it("claims exactly the CDXJ properties the index writes", async () => {
    const cdxj = await readFile(resolve(ROOT, "src", "storage", "wacz", "cdxj.ts"), "utf8");
    const written = new Set(
      [...cdxj.matchAll(/^\s{4}(url|digest|mime|status|length|offset|filename):/gm)].map((m) => m[1]!),
    );

    const area = COVERAGE.find((a) => a.id === "cdxj");
    const claimed = new Set(
      area!.items.filter((i) => i.state === "implemented").map((i) => i.item),
    );

    expect([...claimed].sort()).toEqual([...written].sort());
  });
});
