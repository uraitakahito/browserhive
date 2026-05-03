/**
 * Postprocess @hey-api/openapi-ts output for our toolchain.
 *
 * Prepends `// @ts-nocheck` to every generated *.ts file. The bundled
 * fetch runtime in `client/` and `core/` is not authored against
 * `exactOptionalPropertyTypes: true` (our project default), so tsc
 * rejects it. Skipping type checks on generated files only affects the
 * generated module itself — consumer code still gets the emitted .d.ts
 * and full type safety.
 *
 * (`.js` import extensions are handled by hey-api itself via
 * `output.module.extension` in openapi-ts.config.ts, not here.)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

let count = 0;
for (const file of walk(ROOT)) {
  const content = readFileSync(file, "utf8");
  if (content.startsWith(TS_NOCHECK)) continue;
  writeFileSync(file, TS_NOCHECK + content);
  count += 1;
}

console.log(`postprocessed ${count} file(s) under ${ROOT}`);
