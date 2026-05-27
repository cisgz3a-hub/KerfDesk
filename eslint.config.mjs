// LaserForge 2.0 ESLint flat config.
//
// Enforces the discipline described in CLAUDE.md, ADR-010, and ADR-015:
//   * File-size limits (≤ 400 lines hard, function ≤ 80, complexity ≤ 12)
//   * Module isolation: core / io / platform / ui boundaries
//   * Pure core: no platform globals, no clock, no randomness in src/core/
//   * Type strictness: no `any`, no non-null assertions, consistent type imports

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundariesPlugin from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

const FILE_LINE_LIMIT = 400;
const FUNCTION_LINE_LIMIT = 80;
const COMPLEXITY_LIMIT = 12;

const moduleBoundaries = {
  'boundaries/elements': [
    // Order matters: platform-types is a single file under src/platform/ and
    // must be classified before the broader src/platform/web|electron/
    // patterns are considered. `mode: 'file'` pins it to one file path.
    { type: 'platform-types', pattern: 'src/platform/types.ts', mode: 'file' },
    { type: 'platform-web', pattern: 'src/platform/web', mode: 'folder' },
    { type: 'platform-electron', pattern: 'src/platform/electron', mode: 'folder' },
    { type: 'core', pattern: 'src/core', mode: 'folder' },
    { type: 'io', pattern: 'src/io', mode: 'folder' },
    { type: 'ui', pattern: 'src/ui', mode: 'folder' },
  ],
  'boundaries/ignore': [
    '**/*.test.ts',
    '**/*.test.tsx',
    'src/__fixtures__/**/*',
    'src/vite-env.d.ts',
    // Root web entry: wires platform-web → ui at composition time. Allowed
    // to cross the platform-web boundary by design (ADR-011).
    'src/ui/app/main.tsx',
  ],
};

const boundaryRules = [
  // core may only import core
  { from: 'core', allow: ['core'] },
  // io may import core + io
  { from: 'io', allow: ['core', 'io'] },
  // platform/types may import core (interface uses core domain types)
  { from: 'platform-types', allow: ['core'] },
  // platform implementations import core + the platform-types interface
  { from: 'platform-web', allow: ['core', 'platform-types'] },
  { from: 'platform-electron', allow: ['core', 'platform-types'] },
  // ui may import core, io, and the platform-types interface — but NOT
  // platform/web or platform/electron directly (those go via DI at React root)
  { from: 'ui', allow: ['core', 'io', 'platform-types'] },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'dist-electron/**',
      'coverage/**',
      'node_modules/**',
      '.claude/**',
      'eslint.config.mjs',
      'vite.config.*',
      'vitest.config.*',
      '*.config.js',
      '*.config.cjs',
      // Electron main process compiles under its own tsconfig
      // (electron/tsconfig.json) — exclude from the root lint pass.
      'electron/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    plugins: {
      boundaries: boundariesPlugin,
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      ...moduleBoundaries,
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
      },
    },
    rules: {
      // File-size discipline (ADR-015)
      'max-lines': ['error', { max: FILE_LINE_LIMIT, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: FUNCTION_LINE_LIMIT, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['error', COMPLEXITY_LIMIT],

      // Module isolation (CLAUDE.md "Imports — boundaries enforced")
      'boundaries/element-types': ['error', { default: 'disallow', rules: boundaryRules }],
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'error',

      // Type strictness (CLAUDE.md "Type strictness")
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Type-aware: every switch over a discriminated union must cover every
      // variant. This is how Phase D's TextObject and Phase E's TracedImage
      // produce a localized error in JobCompiler, GrblStrategy, and any other
      // domain-walker — the missing arm IS the to-do list.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Style preferences that don't match the codebase's chosen patterns.
      // We use `type` aliases uniformly (so discriminated unions and object
      // shapes look the same at the type level) and `ReadonlyArray<T>` for
      // its explicitness over the `readonly T[]` punctuation.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/array-type': 'off',
    },
  },
  // Pure core: no platform globals, no clock, no randomness (ADR-010, CLAUDE.md)
  {
    files: ['src/core/**/*.ts', 'src/core/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core/ is platform-agnostic. Move to ui/ or platform/.' },
        { name: 'document', message: 'core/ is platform-agnostic. Move to ui/ or platform/.' },
        { name: 'navigator', message: 'core/ is platform-agnostic. Move to ui/ or platform/.' },
        { name: 'localStorage', message: 'core/ must not do I/O.' },
        { name: 'sessionStorage', message: 'core/ must not do I/O.' },
        { name: 'fetch', message: 'core/ must not do network I/O.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'core/ must not read the clock; pass time in as a parameter.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'core/ must not generate randomness; pass an RNG in as a parameter.',
        },
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'core/ must not construct Date directly; pass timestamps in as parameters.',
        },
      ],
    },
  },
  // Test files: relax file-size and assertion strictness so test scaffolding
  // can use longer describe blocks and `!` for fixture access.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/__fixtures__/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'boundaries/element-types': 'off',
    },
  },
  // Place prettier LAST so it disables conflicting style rules.
  prettierConfig,
);
