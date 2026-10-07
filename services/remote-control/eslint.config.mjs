import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      'worker-configuration.d.ts',
      'test-results/**',
      // Reproducible, reviewed third-party output; checked against the pinned npm source.
      'public/control-scanner-decoder.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.worker,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['error', 12],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['error', 12],
    },
  },
  {
    files: ['test/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['test/mobile.test.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
      },
    },
  },
  prettier,
);
