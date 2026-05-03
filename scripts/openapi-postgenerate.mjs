/**
 * Postprocess @hey-api/openapi-ts output for our toolchain.
 *
 * Two adjustments per generated *.ts file:
 *
 *   1. Prepend `// @ts-nocheck`. The bundled fetch runtime in
 *      `client/` and `core/` is not authored against
 *      `exactOptionalPropertyTypes: true` (our project default), so
 *      tsc rejects it. Skipping type checks on generated files only
 *      affects the generated module itself — consumer code still gets
 *      the emitted .d.ts and full type safety.
 *
 *   2. Rewrite relative `from './foo'` imports to `from './foo.js'`
 *      (or `'./foo/index.js'` for directory imports). hey-api emits
 *      bundler-style extensionless paths; Node's ESM resolver requires
 *      explicit extensions. We resolve against the source tree to
 *      decide between file vs. directory.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/http/generated", import.meta.url));
const TS_NOCHECK = "// @ts-nocheck\n";

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
};

const withJsExtension = (importPath, fileDir) => {
  if (!importPath.startsWith("./") && !importPath.startsWith("../")) return importPath;
  if (/\.(js|mjs|cjs|json)$/.test(importPath)) return importPath;

  const resolved = resolve(fileDir, importPath);
  if (existsSync(`${resolved}.ts`)) return `${importPath}.js`;
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return `${importPath}/index.js`;
  }
  return importPath;
};

const IMPORT_FROM_RE = /(from\s+['"])([^'"]+)(['"])/g;

const rewriteImports = (content, fileDir) =>
  content.replace(IMPORT_FROM_RE, (_m, pre, path, post) =>
    `${pre}${withJsExtension(path, fileDir)}${post}`,
  );

let count = 0;
for (const file of walk(ROOT)) {
  let content = readFileSync(file, "utf8");
  if (!content.startsWith(TS_NOCHECK)) content = TS_NOCHECK + content;
  content = rewriteImports(content, dirname(file));
  writeFileSync(file, content);
  count += 1;
}

console.log(`postprocessed ${count} file(s) under ${ROOT}`);
