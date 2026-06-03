import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Electron source-map packaging policy', () => {
  it('does not emit Electron main-process source maps for production builds', () => {
    const tsconfig = JSON.parse(repoFile('electron/tsconfig.json')) as {
      readonly compilerOptions?: { readonly sourceMap?: boolean };
    };

    expect(tsconfig.compilerOptions?.sourceMap ?? false).toBe(false);
  });

  it('excludes stale Electron source maps from packaged files', () => {
    const builderConfig = repoFile('electron-builder.yml');

    expect(builderConfig).toContain('!dist-electron/**/*.map');
  });

  it('cleans generated Electron output before compiling the desktop main process', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: { readonly ['build:electron-main']?: string };
    };

    expect(packageJson.scripts?.['build:electron-main']).toContain(
      'node scripts/clean-electron-output.mjs && tsc --project electron/tsconfig.json',
    );
  });
});
