/**
 * コードから「事実」を取り出す唯一の入口。
 *
 * browserhive 本体(`../`)の tsconfig を読み込み、ts-morph で
 *  - `@glossary` タグ付きシンボル → 用語集データ
 *  - `// #region <name>` で囲った範囲 → 実ソース片
 * を抽出する。ドキュメント側はこれを呼ぶだけで、コード由来の事実を
 * 手書きコピーせずに済む(=ドリフトしない)。
 */
import { Node, Project, type JSDoc } from "ts-morph";
import { relative, resolve } from "node:path";

// browserhive ルート。docs-site は browserhive の直下にあり、各スクリプト
// (astro dev/build / node)は docs-site を cwd に実行するので、その親 = 本体。
// ※ import.meta.url は astro ビルドで bundle 後の dist パスになり使えない。
const ROOT = resolve(process.cwd(), "..");

const project = new Project({ tsConfigFilePath: resolve(ROOT, "tsconfig.json") });

export interface Term {
  term: string;
  category: string;
  def: string;
  file: string;
  line: number;
}

const tagText = (doc: JSDoc, name: string): string | undefined =>
  doc
    .getTags()
    .find((t) => t.getTagName() === name)
    ?.getCommentText()
    ?.trim();

/** `@glossary` タグの付いた全シンボルを収集して用語データにする。 */
export function glossaryTerms(): Term[] {
  const terms: Term[] = [];
  for (const sf of project.getSourceFiles()) {
    const path = sf.getFilePath();
    if (!path.includes("/src/") || path.includes(".test.")) continue;
    const nodes = [
      ...sf.getClasses(),
      ...sf.getInterfaces(),
      ...sf.getFunctions(),
      ...sf.getTypeAliases(),
      ...sf.getVariableStatements(), // const 機械 / fromCallback など(JSDoc は文に付く)
    ];
    for (const node of nodes) {
      if (!Node.isJSDocable(node)) continue;
      const doc = node.getJsDocs().at(-1);
      if (!doc) continue;
      const term = tagText(doc, "glossary");
      if (!term) continue;
      terms.push({
        term,
        category: tagText(doc, "category") ?? "",
        def: doc.getDescription().trim(),
        file: relative(ROOT, sf.getFilePath()),
        line: node.getStartLineNumber(),
      });
    }
  }
  return terms.sort((a, b) => a.term.localeCompare(b.term));
}

export interface Member {
  name: string;
  type: string;
  doc: string;
}

/** 指定した interface のプロパティ(名前・型・説明)をコードから展開する。 */
export function typeMembers(name: string): Member[] {
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().includes("/src/")) continue;
    const iface = sf.getInterface(name);
    if (!iface) continue;
    return iface.getProperties().map((p) => ({
      name: p.getName() + (p.hasQuestionToken() ? "?" : ""),
      type: p.getType().getText(p),
      doc: p.getJsDocs().at(-1)?.getDescription().trim() ?? "",
    }));
  }
  throw new Error(`interface '${name}' not found in src`);
}

/** `// #region <name>` … `// #endregion` で囲った現在のソース片を返す。 */
export function sourceRegion(file: string, region: string): string {
  const sf = project.getSourceFileOrThrow(resolve(ROOT, file));
  const re = new RegExp(String.raw`//\s*#region\s+${region}\b([\s\S]*?)//\s*#endregion`);
  const m = re.exec(sf.getFullText());
  if (!m) throw new Error(`region '${region}' not found in ${file}`);
  return m[1].replace(/^\n/, "").replace(/\s+$/, "");
}
