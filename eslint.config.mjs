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
import reactHooksPlugin from 'eslint-plugin-react-hooks';
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
      'eslint.electron.config.mjs',
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
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      boundaries: boundariesPlugin,
      import: importPlugin,
      // react-hooks plugin enforces rules-of-hooks + exhaustive-deps.
      // Catches closure-stale-state bugs in useEffect (R-H1 audit
      // finding was exactly this class).
      'react-hooks': reactHooksPlugin,
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
      'boundaries/dependencies': ['error', { default: 'disallow', rules: boundaryRules }],
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'error',
      // CLAUDE.md "No circular imports" — was documented as enforced long
      // before the rule existed (audit H14); now it actually is.
      'import/no-cycle': 'error',

      // React hooks rules (R-H4 audit finding). rules-of-hooks is an
      // error because violations break at runtime; exhaustive-deps is a
      // warning so a deliberate dep-omission (with a comment) doesn't
      // fail CI, but it surfaces in every editor.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

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

      // A5 audit fix: enable the high-value type-aware rules the audit
      // specifically called out, without flipping the whole strictTypeChecked
      // preset (which contradicts project rules — e.g. it wants `!`
      // assertions CLAUDE.md bans, and demands dot-notation that fights
      // tsconfig's noUncheckedIndexedAccess strictness).
      //
      // no-floating-promises is the most important: a missed `await` on
      // safeWrite() in the serial I/O path would let the streamer advance
      // before bytes hit the wire. Real laser-safety win.
      '@typescript-eslint/no-floating-promises': 'error',
      // Catches passing async functions where sync are expected (e.g. as
      // an event handler signature) — silent promise rejection in those
      // spots is a common foot-gun.
      '@typescript-eslint/no-misused-promises': [
        'error',
        // Setting checksVoidReturn=false because React event handlers are
        // typed as void-returning; passing an async function there is the
        // standard idiom and we handle errors inside.
        { checksVoidReturn: false },
      ],
      // Type-aware error checking — catches errors typed `unknown` being
      // treated as `Error` without a narrowing check.
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      // Promise-returning .then chains in tests are fine; the rest of the
      // codebase prefers async/await. This catches forgotten .catch.
      '@typescript-eslint/prefer-promise-reject-errors': 'error',

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
        { name: 'atob', message: 'core/ must not depend on browser base64 globals.' },
        { name: 'btoa', message: 'core/ must not depend on browser base64 globals.' },
        // M29 (AUDIT-2026-06-10): these two were documented as restricted in
        // CLAUDE.md but never configured — globals.node made `process` pass.
        { name: 'console', message: 'core/ must not log directly; use a logger passed in.' },
        { name: 'process', message: 'core/ is platform-agnostic. Move to ui/ or platform/.' },
      ],
      // M29: CLAUDE.md claims a no-restricted-imports gate for pure core;
      // it never existed, so `import fs from "node:fs"` would have passed
      // lint AND typecheck (@types/node is installed).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'child_process', 'worker_threads'],
              message: 'core/ must not import Node.js APIs; push I/O to io/ or platform/.',
            },
          ],
        },
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
  // ADR-047: chrome colors come from tokens.css custom properties — a raw
  // hex or rgb()/rgba() string literal in src/ui is almost always a missed
  // token (the white-on-white FontPicker regression was exactly this
  // class). Selectors only match string LITERALS, so identifiers like
  // lumaToRgba() and comments never trip it. Justified exceptions carry an
  // eslint-disable with a reason: scene DATA colors (layer keys) and the
  // deliberate light-surface palettes on canvas-adjacent previews.
  {
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    ignores: ['src/ui/theme/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}/]',
          message:
            'Raw hex color in ui/ chrome — use a var(--lf-*) token from src/ui/theme/tokens.css (ADR-047). Scene-data colors get a justified eslint-disable.',
        },
        {
          selector: 'Literal[value=/rgba?\\(/]',
          message:
            'Raw rgb()/rgba() color in ui/ chrome — use a var(--lf-*) token from src/ui/theme/tokens.css (ADR-047).',
        },
      ],
    },
  },
  // Test files: relax file-size and assertion strictness so test scaffolding
  // can use longer describe blocks and `!` for fixture access. Tests run in
  // node, so reading fixtures via node:fs is fine (the no-restricted-imports
  // gate protects shipped core code, not its tests).
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/__fixtures__/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'boundaries/dependencies': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  // Place prettier LAST so it disables conflicting style rules.
  prettierConfig,
);
