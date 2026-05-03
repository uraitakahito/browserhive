/**
 * Pre-dereference the OpenAPI spec at build time.
 *
 * Reads `src/http/openapi.yaml`, fully resolves all `$ref` references,
 * and writes the result to `dist/openapi.dereferenced.json`.
 *
 * The runtime server (src/http/server.ts) reads this JSON to wire up
 * Fastify's Ajv schemas. Pre-dereferencing at build time means
 * `@apidevtools/swagger-parser` (and the source YAML) are not required
 * in the production image.
 */
import SwaggerParser from "@apidevtools/swagger-parser";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = resolve(ROOT, "src/http/openapi.yaml");
const OUTPUT = resolve(ROOT, "dist/openapi.dereferenced.json");

const document = await SwaggerParser.dereference(SOURCE);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(document, null, 2));

console.log(`bundled dereferenced spec to ${OUTPUT}`);
