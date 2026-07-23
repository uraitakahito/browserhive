// File names and extensions defined in the linked source are allowed as configuration files.
// https://github.com/vitest-dev/vitest/blob/5d4b38282f095b2ab19883859569c6e26d7747a3/packages/vitest/src/constants.ts#L15-L19
//

import { defineConfig } from "vitest/config";

// Two Vitest projects (https://vitest.dev/guide/projects):
//   - unit: the fast default. `npm test` runs ONLY this — e2e is never collected.
//   - e2e:  black-box tests against a running stack (container-compose
//           --profile e2e up -d -b). Opt in with `npm run test:e2e`; its
//           globalSetup waits (bounded) for the stack and fails loudly if it
//           never comes up, instead of silently skipping.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          setupFiles: ["./test/setup.ts"],
          include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          exclude: ["test/e2e/**"],
          // Allow running without test files (all tests were removed with CSV batch mode)
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "e2e",
          globals: true,
          include: ["test/e2e/**/*.e2e.test.ts"],
          // Reads .e2e-stack.json + probes /v1/status; only runs for this project.
          globalSetup: ["./test/e2e/global-setup.ts"],
          // Real browser captures are slow; bound generously and run serially.
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
