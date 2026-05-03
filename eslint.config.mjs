// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import importXPlugin from 'eslint-plugin-import-x';

export default defineConfig(
  //
  // Global ignores
  //
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'vitest.config.mts', 'openapi-ts.config.ts', 'src/http/generated/**', 'scripts/**', '.Trash-*/**'],
  },

  //
  // Base configurations
  //
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  //
  // TypeScript parser options
  //
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  //
  // Import plugin configuration
  //
  {
    plugins: {
      'import-x': importXPlugin,
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
        node: true,
      },
    },
    rules: {
      // Require file extensions for ES modules
      // In TypeScript ESM, .ts files are imported with the .js extension —
      // this is what Node.js (the runtime we ship) resolves against the
      // generated dist/*.js output.
      'import-x/extensions': [
        'error',
        'always',
        {
          ignorePackages: true,
          checkTypeImports: true,
          pattern: {
            // Since .ts/.tsx files are imported with .js extension,
            // disable extension check for ts/tsx itself and enforce .js
            ts: 'never',
            tsx: 'never',
            js: 'always',
            mjs: 'always',
            cjs: 'always',
          },
        },
      ],
      // Prohibit anonymous default exports
      'import-x/no-anonymous-default-export': ['error', { allowCallExpression: false }],
    },
  },

  //
  // Runtime syntax extension restrictions (erasable syntax only)
  //
  // TypeScript などのスーパーセット言語固有の新しいランタイム機能によって
  // JavaScript の構文を拡張することは、次のような理由により、よくないことと考えられています。
  // - ランタイム構文の拡張は、JavaScript の新しいバージョンの新しい構文と競合する可能性がある
  // - JavaScript に不慣れなプログラマーにとって、どこまでが JavaScript かを理解するのが困難になる
  // - トランスパイラーの複雑さが増加する
  //
  {
    rules: {
      // Parameter Properties の禁止
      // https://typescript-eslint.io/rules/parameter-properties/
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],

      // Enums, Export Assignment, Decorators の禁止
      // https://eslint.org/docs/latest/rules/no-restricted-syntax
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Enums are not allowed. Use a union type or a const object instead.',
        },
        {
          selector: 'TSExportAssignment',
          message: 'Export assignment (`export =`) is not allowed. Use ES module export syntax instead.',
        },
        {
          selector: 'Decorator',
          message: 'Legacy experimental decorators are not allowed.',
        },
      ],
    },
  },

  //
  // Test-specific rules (all test files)
  //
  {
    files: ['test/**/*.ts'],
    rules: {
      // Allow non-null assertions in tests (commonly used after expect().toBeDefined())
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  //
  // Mock-specific rules
  //
  {
    files: ['test/capture/browser-client.test.ts'],
    rules: {
      // Allow unsafe returns in mocks
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  //
  // Capture worker machine tests (mock BrowserClient objects with vi.mocked)
  //
  {
    files: ['test/capture/capture-worker.test.ts'],
    rules: {
      // Allow unbound method references for mock objects (vi.mocked(client.connect))
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  //
  // Naming convention rules
  //
  {
    ignores: ['test/capture/browser-client.test.ts'],
    rules: {
      // Naming convention (TypeScript Handbook + JavaScript conventions + ESLint recommendations)
      // Reference: https://typescript-eslint.io/rules/naming-convention/
      //            https://basarat.gitbook.io/typescript/styleguide
      '@typescript-eslint/naming-convention': [
        'warn',
        // Default: camelCase, allow underscores
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        // Variables: camelCase + UPPER_CASE (for constants)
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
        },
        // Destructured variables: allow external origins
        {
          selector: 'variable',
          modifiers: ['destructured'],
          format: null,
        },
        // Parameters: camelCase, allow leading underscore
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        // Functions: camelCase (PascalCase also allowed for React components, etc.)
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        // Accessors: camelCase
        {
          selector: 'accessor',
          format: ['camelCase'],
        },
        // Type-related: PascalCase
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        // Enum: PascalCase
        {
          selector: 'enum',
          format: ['UPPER_CASE'],
        },
        // Enum member: UPPER_CASE
        {
          selector: 'enumMember',
          format: ['UPPER_CASE'],
        },
        // Object literal properties: allow external formats (HTTP headers, API contracts)
        {
          selector: 'objectLiteralProperty',
          format: null,
        },
        // Import: camelCase + PascalCase
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],
    },
  },
);
