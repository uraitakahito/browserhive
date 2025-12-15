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
    ignores: ['dist/**', 'node_modules/**', '.Trash-*/**'],
  },

  //
  // Base configurations (TypeScript files only)
  //
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
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
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    plugins: {
      // @ts-expect-error Type mismatch between eslint-plugin-import-x and ESLint Plugin type
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
      // In TypeScript, .ts files are imported with .js extension
      // .js extension is required to enable execution in both tsx and Node.js
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
  // Mock-specific rules (only files using vi.mock with snake_case gRPC types)
  //
  {
    files: ['test/capture/worker.test.ts', 'test/grpc/handlers.test.ts'],
    rules: {
      // Relax naming convention for mock objects (gRPC types use snake_case)
      '@typescript-eslint/naming-convention': 'off',
      // Allow unsafe returns in mocks
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  //
  // Custom rules
  //
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    ignores: ['test/capture/worker.test.ts', 'test/grpc/handlers.test.ts'],
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
          format: ['PascalCase'],
        },
        // Enum member: PascalCase
        {
          selector: 'enumMember',
          format: ['PascalCase'],
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
