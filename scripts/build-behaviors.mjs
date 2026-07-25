#!/usr/bin/env node
/**
 * Bundle the behavior runtime (src/behaviors/runtime/) into a single IIFE that
 * browserhive injects into each captured page. Runs AFTER `tsc` (see the
 * `build` script) and writes into dist/src/ so the Docker runtime stage — which
 * only copies `dist/src` — picks it up.
 *
 * The runtime uses browser globals (window/document/self) and is intentionally
 * excluded from the tsc build; esbuild transpiles + bundles it here.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/behaviors/runtime/index.ts"],
  outfile: "dist/src/behaviors/runtime.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  legalComments: "none",
});

console.log("built dist/src/behaviors/runtime.js");
