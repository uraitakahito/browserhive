/**
 * Generate runtime constants from src/http/openapi.yaml.
 *
 * Currently extracts servers[0].url -> DEFAULT_SERVER_ADDRESS, used as the
 * default --server fallback for examples/csv-client.ts. Chained behind
 * `openapi:generate` so the generated TS stays in lock-step with the
 * openapi-typescript output.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";

const OPENAPI_PATH = fileURLToPath(
  new URL("../src/http/openapi.yaml", import.meta.url),
);
const OUTPUT_PATH = fileURLToPath(
  new URL("../src/http/generated/server.ts", import.meta.url),
);

const document = await SwaggerParser.dereference(OPENAPI_PATH);

const servers = document.servers;
if (!Array.isArray(servers) || servers.length === 0) {
  throw new Error("openapi.yaml: servers[] must be non-empty");
}
const url = servers[0]?.url;
if (typeof url !== "string" || url.length === 0) {
  throw new Error("openapi.yaml: servers[0].url is required");
}

const content = `// AUTO-GENERATED from src/http/openapi.yaml — do not edit.
// Regenerate with \`npm run openapi:generate\`.

export const DEFAULT_SERVER_ADDRESS = ${JSON.stringify(url)} as const;
`;

writeFileSync(OUTPUT_PATH, content);
console.log(`generated ${OUTPUT_PATH}`);
