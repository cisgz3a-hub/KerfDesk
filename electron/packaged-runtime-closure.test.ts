import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { desktopRuntimeGraph } from '../scripts/desktop-runtime-graph.mjs';

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
const GRAPH = desktopRuntimeGraph({
  entry: 'electron/main.ts',
  source: true,
  readFile: (path: string) =>
    existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : null,
});

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
    readonly optionalDependencies?: Record<string, string>;
  };
  seen.add(name);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (!Object.hasOwn(manifest.optionalDependencies ?? {}, dependency))
      installedClosure(dependency, packageDir, seen);
  }
  return seen;
}

describe('packaged main-process dependencies (ADR-483)', () => {
  it('includes every shared public module reachable from main in all standalone profiles', () => {
    const required = GRAPH.files.filter((path: string) => path.startsWith('public/'));
    expect(required).toContain('public/desktop-manual-download.mjs');
    expect(required).toContain('public/desktop-commercial-catalog.mjs');
    for (const config of BUILDER_CONFIGS) {
      const yaml = readFileSync(join(ROOT, config), 'utf8');
      for (const path of required)
        expect(yaml, `${config} missing ${path}`).toContain(`  - ${path}`);
    }
  });
  it('finds nested runtime imports while excluding types and unreachable SDK entry points', () => {
    expect(GRAPH.packages).toEqual(['electron-updater', 'ws', 'zod']);
    expect(GRAPH.files).toContain('electron/remote-access/relay-client.ts');
    expect(GRAPH.files).toContain('electron/mcp/input-schemas.ts');
    expect(GRAPH.files).not.toContain('electron/mcp/server.ts');
    expect(GRAPH.files).not.toContain('electron/mcp/stdio.ts');
  });

  it('ships exactly the reachable runtime packages and their mandatory installed dependencies', () => {
    const closure = new Set<string>();
    for (const name of GRAPH.packages) installedClosure(name, ROOT, closure);
    for (const config of BUILDER_CONFIGS) {
      expect(shippedNodeModules(config), config).toEqual([...closure].sort());
    }
  });
});
