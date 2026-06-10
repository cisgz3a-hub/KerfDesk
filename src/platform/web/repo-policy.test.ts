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

  it('uses one cross-platform file-size backstop in CI and deploy workflows', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      readonly scripts?: { readonly ['check:file-size']?: string };
    };
    const ciWorkflow = repoFile('.github/workflows/ci.yml');
    const deployWorkflow = repoFile('.github/workflows/deploy.yml');

    expect(packageJson.scripts?.['check:file-size']).toBe(
      'node scripts/check-file-size-policy.mjs',
    );
    expect(ciWorkflow).toContain('run: pnpm check:file-size');
    expect(deployWorkflow).toContain('run: pnpm check:file-size');
  });
});
