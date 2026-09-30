import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-483: app.asar ships only the node_modules the main process loads. The
// renderer is bundled into dist/web, so every other production dependency is
// dead weight in the desktop package. These checks keep the builder configs'
// allowlist equal to what main actually needs.

const ROOT = process.cwd();
const BUILDER_CONFIGS = [
  'electron-builder.yml',
  'electron-builder.preview.yml',
  'electron-builder.sandbox.yml',
];
const MAIN_PROCESS_PACKAGES = ['electron-updater'];

function shippedNodeModules(config: string): string[] {
  const yaml = readFileSync(join(ROOT, config), 'utf8');
  expect(yaml, config).toContain("- '!**/node_modules/**/*'");
  const match = /^ {2}- '\*\*\/node_modules\/\{([^}]+)\}\/\*\*\/\*'$/m.exec(yaml);
  if (match?.[1] === undefined) throw new Error(`${config} has no node_modules allowlist`);
  return match[1].split(',').sort();
}

/** The package and everything it depends on at runtime, as installed. */
function installedClosure(name: string, fromDir: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return seen;
  const require = createRequire(join(fromDir, 'noop.js'));
  const packageDir = realpathSync(dirname(require.resolve(`${name}/package.json`)));
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    readonly dependencies?: Record<string, string>;
  };
  seen.add(name);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    installedClosure(dependency, packageDir, seen);
  }
  return seen;
}

function mainProcessImports(): Set<string> {
  const specifiers = new Set<string>();
  const sources = readdirSync(join(ROOT, 'electron')).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  );
  for (const file of sources) {
    const text = readFileSync(join(ROOT, 'electron', file), 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'([^'.][^']*)'/g)) {
      if (match[1] !== undefined) specifiers.add(match[1]);
    }
  }
  return specifiers;
}

function requiredPublicModules(): Set<string> {
  const publicRoot = join(ROOT, 'public');
  const seen = new Set<string>();
  const queue = readdirSync(join(ROOT, 'electron'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(ROOT, 'electron', name));
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index]!;
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const specifier = match[1]!;
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const inPublic = relative(publicRoot, target);
      if (inPublic.startsWith('..') || !inPublic.endsWith('.mjs') || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return new Set([...seen].map((path) => relative(ROOT, path).replaceAll('\\', '/')));
}

describe('packaged main-process dependencies (ADR-483)', () => {
  it('includes every shared public module reachable from main in all standalone profiles', () => {
    const required = requiredPublicModules();
    expect(required.has('public/desktop-manual-download.mjs')).toBe(true);
    expect(required.has('public/desktop-commercial-catalog.mjs')).toBe(true);
    for (const config of BUILDER_CONFIGS) {
      const yaml = readFileSync(join(ROOT, config), 'utf8');
      for (const path of required)
        expect(yaml, `${config} missing ${path}`).toContain(`  - ${path}`);
    }
  });
  it('loads only Electron, Node built-ins and the updater', () => {
    const packages = [...mainProcessImports()].filter(
      (specifier) => specifier !== 'electron' && !specifier.startsWith('node:'),
    );
    expect(packages.sort()).toEqual(MAIN_PROCESS_PACKAGES);
  });

  it('ships exactly the updater and its installed dependencies', () => {
    const closure = new Set<string>();
    for (const name of MAIN_PROCESS_PACKAGES) installedClosure(name, ROOT, closure);
    for (const config of BUILDER_CONFIGS) {
      expect(shippedNodeModules(config), config).toEqual([...closure].sort());
    }
  });
});
