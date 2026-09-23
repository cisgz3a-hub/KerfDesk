import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { APP_DISPLAY_NAME } from './app-branding';

// "CurveDesk" was never an approved name for KerfDesk (see
// docs/audits/2026-07-26-kerfdesk-electron-desktop-quality-audit.md, which asks
// for a CI branding allowlist). The scan reads string literals, template chunks,
// and JSX text from the TypeScript AST, so comments never trip it, and every
// match must be one of the exact legacy identifiers below.

const REPO_ROOT = resolve(__dirname, '../..');
const SCAN_ROOTS = ['src', 'electron'];
// Test-only fixture trees never ship; *.test.ts(x) files are skipped too.
const FIXTURE_DIRECTORY = '__fixtures__';
const SOURCE_FILE = /\.tsx?$/u;
const TEST_FILE = /\.test\.tsx?$/u;
const WRONG_NAME = /curve[\s_-]*desk/iu;

// Machine identifiers minted under the wrong name. None is ever rendered, and
// most are stored (IndexedDB, localStorage, saved projects) or shared between
// windows, so renaming them would orphan user data; each stays byte-exact.
const LEGACY_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
  ['curvedesk-import-assets-v1', 'IndexedDB page-asset database; saved projects pin it'],
  ['curvedesk-project-autosave-v1', 'IndexedDB autosave database'],
  ['curvedesk-page-asset-lease', 'Web Locks namespace shared across windows'],
  ['curvedesk-page-asset-staging', 'Web Locks namespace shared across windows'],
  ['curvedesk-project-autosave-session', 'Web Locks namespace shared across windows'],
  ['application/x-curvedesk-luma', 'MIME type recorded in stored page-asset manifests'],
  ['curvedesk.console.user-macros.v1', 'localStorage key for saved console macros'],
  ['curvedesk:user-macros-changed', 'in-page Event type; never rendered'],
  ['curvedesk.executable-plan', 'schema const in docs/schemas/executable-plan-v1.schema.json'],
  ['CurveDesk\0heightfield-v1\0', 'digest domain; saved relief digests are checked against it'],
]);

// Shipped files outside the TypeScript scan that carry the product name: the
// page shell, PWA manifest, package metadata, installer config, and public
// pages. None holds a legacy identifier, so any spelling of the name fails.
const BRANDING_FILES = [
  'index.html',
  'vite.config.ts',
  'package.json',
  'electron-builder.yml',
  'electron-builder.preview.yml',
];
const PUBLIC_TEXT_FILE = /\.(?:html|txt)$/u;

// The scan reads every shipped source file once. That is quick on a warm disk,
// but Vitest fails a slow synchronous test after the fact, so a loaded Windows
// runner gets a timeout that only a hung disk would exceed.
const SCAN_OPTIONS = { timeout: 60_000 };

type NameUse = { readonly location: string; readonly value: string };

let usesCache: ReadonlyArray<NameUse> | null = null;

describe('app branding', () => {
  it('names the product KerfDesk', () => {
    expect(APP_DISPLAY_NAME).toBe('KerfDesk');
  });

  it('reads strings, template chunks, and JSX text but not comments', () => {
    const sample = [
      '// CurveDesk in a line comment',
      '/* Curve Desk in a block comment */',
      "const a = 'Reopen curve desk';",
      'const b = `${a} and CURVE-DESK`;',
      "const c = 'curvedesk-import-assets-v1';",
      'const d = <p title="Curve_Desk">Made by CurveDesk</p>;',
    ].join('\n');

    expect(wrongNameUses('sample.tsx', sample).map((use) => use.value)).toEqual([
      'Reopen curve desk',
      ' and CURVE-DESK',
      'curvedesk-import-assets-v1',
      'Curve_Desk',
      'Made by CurveDesk',
    ]);
  });

  it('keeps the wrong CurveDesk name out of every shipped source string', SCAN_OPTIONS, () => {
    const unexpected = shippedNameUses()
      .filter((use) => !LEGACY_IDENTIFIERS.has(use.value))
      .map((use) => `${use.location} ${JSON.stringify(use.value)}`);

    expect(unexpected).toEqual([]);
  });

  it('allowlists only legacy identifiers that shipped source still uses', SCAN_OPTIONS, () => {
    const values = new Set(shippedNameUses().map((use) => use.value));
    const stale = [...LEGACY_IDENTIFIERS.keys()].filter((value) => !values.has(value));

    expect(stale).toEqual([]);
  });

  it('keeps it out of the page shell, manifest, installer, and public pages', () => {
    const publicFiles = readdirSync(join(REPO_ROOT, 'public'))
      .filter((name) => PUBLIC_TEXT_FILE.test(name))
      .map((name) => `public/${name}`);
    const files = [...BRANDING_FILES, ...publicFiles];
    const offenders = files.filter((file) =>
      WRONG_NAME.test(readFileSync(join(REPO_ROOT, file), 'utf8')),
    );

    expect(publicFiles).toContain('public/download.html');
    expect(offenders).toEqual([]);
  });
});

function shippedNameUses(): ReadonlyArray<NameUse> {
  if (usesCache === null) {
    const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)));
    usesCache = files.flatMap(fileNameUses);
  }
  return usesCache;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === FIXTURE_DIRECTORY ? [] : sourceFiles(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

function fileNameUses(file: string): NameUse[] {
  const text = readFileSync(file, 'utf8');
  // Parse only the few files whose raw text mentions the name at all.
  return WRONG_NAME.test(text) ? wrongNameUses(file, text) : [];
}

function wrongNameUses(file: string, text: string): NameUse[] {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const uses: NameUse[] = [];
  const visit = (node: ts.Node): void => {
    const value = textValue(node);
    if (value !== null && WRONG_NAME.test(value)) {
      const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      uses.push({ location: `${repoPath(file)}:${line + 1}`, value });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return uses;
}

function textValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
    return node.text;
  }
  return null;
}

function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/');
}
