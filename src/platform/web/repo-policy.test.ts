import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('repository policy enforcement contract', () => {
  it('does not document a nonexistent per-file test-coverage lint rule', () => {
    const manual = repoFile('CLAUDE.md');

    expect(manual).not.toContain('require-test-coverage');
    expect(manual).toContain('CI does not enforce a direct sibling-test rule');
  });

  it('keeps the written file-size rule aligned with ESLint line counting', () => {
    const manual = repoFile('CLAUDE.md');
    const eslintConfig = repoFile('eslint.config.mjs');

    expect(manual).toContain('excluding blank and comment lines');
    expect(manual).toContain('600 raw physical lines');
    expect(eslintConfig).toContain('skipBlankLines: true');
    expect(eslintConfig).toContain('skipComments: true');
  });

  // H14 (AUDIT-2026-06-10): CLAUDE.md documented `import/no-cycle: error`
  // years of commits before the rule existed, and the test script's
  // --passWithNoTests was the opposite of the documented gate. Pin both so
  // the manual and the config cannot drift apart again silently.
  it('actually enforces the documented no-circular-imports rule', () => {
    const manual = repoFile('CLAUDE.md');
    const eslintConfig = repoFile('eslint.config.mjs');

    expect(manual).toContain('import/no-cycle');
    expect(eslintConfig).toContain("'import/no-cycle': 'error'");
  });

  it('fails the test script when no tests are found', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: { readonly test?: string };
    };

    expect(packageJson.scripts?.test).not.toContain('--passWithNoTests');
  });

  // M34 (AUDIT-2026-06-10): license-checker@25 cannot traverse pnpm's
  // symlinked layout — it certified exactly the 6 direct deps while the
  // installed transitive production tree was invisible.
  it('uses the pnpm-aware license gate', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: { readonly ['license-check']?: string };
      readonly devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts?.['license-check']).toBe('node scripts/check-licenses.mjs');
    expect(packageJson.devDependencies?.['license-checker']).toBeUndefined();
    expect(repoFile('scripts/check-licenses.mjs')).toContain('pnpm licenses list --prod --json');
  });

  // M29 (AUDIT-2026-06-10): CLAUDE.md claimed a no-restricted-imports / console
  // gate for pure core that never existed until 01907f2 added it — but that
  // commit shipped no pinning test, so the exact config-drift class the audit
  // caught (documented-but-unconfigured rule) could recur for these rules too.
  it('enforces the pure-core console/process and node-import bans', () => {
    const eslintConfig = repoFile('eslint.config.mjs');

    // The bans are scoped to pure core.
    expect(eslintConfig).toContain("files: ['src/core/**/*.ts', 'src/core/**/*.tsx']");
    // console + process are banned globals in core (logger / platform pushed out).
    expect(eslintConfig).toContain("name: 'console'");
    expect(eslintConfig).toContain("name: 'process'");
    // Node built-ins are banned imports in core (I/O pushed to io/ or platform/).
    expect(eslintConfig).toContain(
      "group: ['node:*', 'fs', 'path', 'os', 'child_process', 'worker_threads']",
    );
  });

  it('uses one cross-platform file-size backstop in CI and deploy workflows', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: {
        readonly ['check:file-size']?: string;
        readonly ['release:check']?: string;
      };
    };
    const ciWorkflow = repoFile('.github/workflows/ci.yml');
    const deployWorkflow = repoFile('.github/workflows/deploy.yml');
    const releaseCheck = packageJson.scripts?.['release:check'] ?? '';

    expect(packageJson.scripts?.['check:file-size']).toBe(
      'node scripts/check-file-size-policy.mjs',
    );
    expect(releaseCheck).toContain('pnpm check:file-size');
    expect(ciWorkflow).toContain('run: pnpm release:check');
    expect(deployWorkflow).toContain('run: pnpm release:check');
  });

  it('exposes the local RTSP camera bridge for browser development', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: { readonly ['camera:bridge']?: string };
    };

    expect(packageJson.scripts?.['camera:bridge']).toBe(
      'pnpm build:electron-main && node dist-electron/rtsp-camera-bridge-cli.js',
    );
  });
});
