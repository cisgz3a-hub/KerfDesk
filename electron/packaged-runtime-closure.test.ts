import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-483: app.asar ships only the node_modules the main process loads. The
// renderer is bundled into dist/web, so every other production dependency is
// dead weight in the desktop package. These checks keep the builder configs'
// allowlist equal to what main actually needs.

const ROOT = process.cwd();
const BUILDER_CONFIGS = ['electron-builder.yml', 'electron-builder.preview.yml'];
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

describe('packaged main-process dependencies (ADR-483)', () => {
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
