import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('repository policy enforcement contract', () => {
  it('does not document a nonexistent per-file test-coverage lint rule', () => {
    for (const path of ['AGENTS.md', 'CLAUDE.md']) {
      expect(repoFile(path)).not.toContain('require-test-coverage');
    }
  });

  it('enforces counted code lines separately from the raw-line backstop', () => {
    const eslintConfig = repoFile('eslint.config.mjs');
    const rawLineGate = repoFile('scripts/check-file-size-policy.mjs');

    expect(eslintConfig).toContain('const FILE_LINE_LIMIT = 400');
    expect(eslintConfig).toContain("'max-lines': ['error', { max: FILE_LINE_LIMIT");
    expect(eslintConfig).toContain('skipBlankLines: true');
    expect(eslintConfig).toContain('skipComments: true');
    expect(rawLineGate).toContain('const MAX_RAW_LINES = 600');
    expect(rawLineGate).toContain('const TEST_MAX_RAW_LINES = 900');
  });

  // H14 (AUDIT-2026-06-10): the documented circular-import and test-discovery
  // gates were not configured. Pin enforcement independently of agent guidance.
  it('enforces the no-circular-imports rule', () => {
    const eslintConfig = repoFile('eslint.config.mjs');

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

  it('gates public-export growth with a checked-in legacy baseline', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: { readonly ['release:check']?: string };
    };
    const gate = repoFile('scripts/check-index-exports.mjs');

    expect(packageJson.scripts?.['release:check']).toContain('pnpm check:index-exports');
    expect(gate).toContain('scripts/index-export-baseline.json');
    expect(gate).toContain('process.exit(1)');
  });

  it('runs Chrome E2E in a dedicated workflow outside release and deploy gates', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: {
        readonly ['release:check']?: string;
        readonly ['test:e2e']?: string;
        readonly ['test:e2e:production-bundle']?: string;
        readonly ['typecheck:e2e']?: string;
      };
    };
    const browserWorkflow = repoFile('.github/workflows/e2e.yml');
    const ciWorkflow = repoFile('.github/workflows/ci.yml');
    const deployWorkflow = repoFile('.github/workflows/deploy.yml');

    expect(packageJson.scripts?.['test:e2e']).toBe('playwright test');
    expect(packageJson.scripts?.['test:e2e:production-bundle']).toContain(
      '--config=playwright-production.config.ts',
    );
    expect(packageJson.scripts?.['typecheck:e2e']).toBe('tsc --noEmit -p e2e/tsconfig.json');
    expect(packageJson.scripts?.['release:check']).not.toContain('pnpm test:e2e');
    expect(browserWorkflow).toContain('run: pnpm typecheck:e2e');
    expect(browserWorkflow).toContain('run: pnpm test:e2e');
    expect(browserWorkflow).toContain('pnpm test:e2e:production-bundle');
    expect(repoFile('playwright.config.ts')).toContain(
      "testIgnore: ['**/production-bundle.spec.ts']",
    );
    expect(repoFile('playwright-production.config.ts')).toContain('pnpm exec vite preview');
    expect(repoFile('playwright-production.config.ts')).toContain('production-bundle.spec.ts');
    expect(ciWorkflow).not.toContain('playwright install');
    expect(deployWorkflow).not.toContain('playwright install');
  });

  it('does not provision Playwright browsers in desktop jobs that never run Playwright', () => {
    for (const path of [
      '.github/workflows/release-desktop-stable.yml',
      '.github/workflows/release-desktop-preview.yml',
      '.github/workflows/release-desktop-dry-run.yml',
    ]) {
      const workflow = repoFile(path);
      expect(workflow).not.toContain('playwright install');
      expect(workflow).not.toContain('playwright test');
    }
  });

  it('pre-bundles cold document-worker dependencies before the first import', () => {
    const viteConfig = repoFile('vite.config.ts');

    expect(viteConfig).toContain("include: ['linkedom/worker', 'saxes', 'opentype.js']");
  });
});
