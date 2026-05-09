import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Configuration file for @hey-api/openapi-ts (https://heyapi.dev/openapi-ts).
 *
 * Single source of truth: src/http/openapi.yaml.
 *
 * Generates types, an operationId-keyed SDK (e.g. `submitCapture(...)`),
 * and a fetch-based client into src/http/generated/. The default client
 * baseUrl is auto-extracted from `servers[0].url` in the spec.
 */
export default defineConfig({
  input: "src/http/openapi.yaml",
  output: {
    path: "src/http/generated",
    // Force `.js` on relative import specifiers in the generated source.
    //
    // Three facts collide:
    //   1. Runtime is Node ESM, whose resolver REJECTS extensionless
    //      relative paths (no CJS-style auto-resolution) — Node throws
    //      ERR_MODULE_NOT_FOUND.
    //   2. `tsc` does not rewrite import specifiers; whatever hey-api
    //      writes in the .ts source ends up verbatim in dist/.
    //   3. hey-api auto-detects whether to emit extensions by reading
    //      tsconfig's `moduleResolution`, but only "NodeNext"/"Node16"
    //      trigger it. This project uses "Bundler" (so handwritten code
    //      can omit extensions during dev), which silences that
    //      auto-detection.
    //
    // Without this override the emitted JS would `import './sdk.gen'`
    // (no extension) and Node would refuse to load it.
    module: { extension: ".js" },
  },
  plugins: ["@hey-api/client-fetch"],
});
