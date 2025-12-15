// File names and extensions defined in the linked source are allowed as configuration files.
// https://github.com/vitest-dev/vitest/blob/5d4b38282f095b2ab19883859569c6e26d7747a3/packages/vitest/src/constants.ts#L15-L19
//

import { defineConfig } from "vitest/config";

// https://vitest.dev/config/
export default defineConfig({
  test: {
    // All global APIs are here:
    // https://github.com/vitest-dev/vitest/blob/5d4b38282f095b2ab19883859569c6e26d7747a3/packages/vitest/src/constants.ts#L31-L54
    globals: true,
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    // Allow running without test files (all tests were removed with CSV batch mode)
    passWithNoTests: true,
    // Setup files run before each test file
    setupFiles: ["./test/setup.ts"],
  },
});
