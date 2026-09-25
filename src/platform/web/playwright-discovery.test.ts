// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function checkDiscovery(cli: string) {
  const root = mkdtempSync(join(tmpdir(), 'kerfdesk-discovery-'));
  try {
    for (const directory of ['scripts', 'e2e', 'node_modules/@playwright/test']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    copyFileSync(
      join(process.cwd(), 'scripts/check-playwright-discovery.mjs'),
      join(root, 'scripts/check-playwright-discovery.mjs'),
    );
    for (const file of ['workspace-responsive.e2e.ts', 'production-bundle.spec.ts']) {
      writeFileSync(join(root, 'e2e', file), '');
    }
    writeFileSync(join(root, 'node_modules/@playwright/test/cli.js'), cli);
    return spawnSync(process.execPath, [join(root, 'scripts/check-playwright-discovery.mjs')], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('captures a large immediate-exit listing including its final browser suite', () => {
  const result = checkDiscovery(`
    const production = process.argv.includes('--config=playwright-production.config.ts');
    process.stdout.write('  earlier.e2e.ts:1:1 test\\n'.repeat(60000));
    process.stdout.write(production
      ? '  production-bundle.spec.ts:1:1 test\\n'
      : '  workspace-responsive.e2e.ts:1:1 test\\n');
    process.exit(0);
  `);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('discovered all 1 browser suites');
});

it('still rejects a missing browser suite', () => {
  const result = checkDiscovery("process.stdout.write('  unrelated.e2e.ts:1:1 test\\n');");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('- workspace-responsive.e2e.ts');
});

it('still rejects a missing production suite after default discovery succeeds', () => {
  const result = checkDiscovery(
    "process.stdout.write('  workspace-responsive.e2e.ts:1:1 test\\n');",
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('- production-bundle.spec.ts');
});

it('preserves a failed listing exit code and diagnostics', () => {
  const result = checkDiscovery("process.stderr.write('fixture loader failed'); process.exit(7);");
  expect(result.status).toBe(7);
  expect(result.stderr).toContain('fixture loader failed');
});
