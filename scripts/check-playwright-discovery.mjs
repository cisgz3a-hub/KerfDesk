import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE_PATTERN = /\.(?:e2e|spec)\.ts$/;
const LISTING_FILE_PATTERN = /^\s+(.+\.(?:e2e|spec)\.ts):\d+:\d+\s/gm;
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2eRoot = resolve(workspaceRoot, 'e2e');
const playwrightCli = resolve(workspaceRoot, 'node_modules', '@playwright', 'test', 'cli.js');

function browserTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return browserTestFiles(path);
    return TEST_FILE_PATTERN.test(entry.name) ? [path] : [];
  });
}

const productionFiles = ['production-bundle.spec.ts'];
const expectedFiles = browserTestFiles(e2eRoot)
  .map((path) => relative(e2eRoot, path).replaceAll('\\', '/'))
  .filter((path) => !productionFiles.includes(path));

verifyDiscovery({ expectedFiles, args: [], label: 'default browser' });
verifyDiscovery({
  expectedFiles: productionFiles,
  args: ['--config=playwright.production.config.ts'],
  label: 'production bundle',
});

process.stdout.write(
  `Playwright discovered all ${expectedFiles.length} browser suites and the production-bundle suite.\n`,
);

function verifyDiscovery({ expectedFiles: expected, args, label }) {
  const result = spawnSync(process.execPath, [playwrightCli, 'test', ...args, '--list'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });

  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  const listing = result.stdout.replaceAll('\\', '/');
  const discoveredFiles = new Set(
    Array.from(listing.matchAll(LISTING_FILE_PATTERN), (match) => match[1]),
  );
  const missingFiles = expected.filter((path) => !discoveredFiles.has(path));

  if (missingFiles.length > 0) {
    process.stderr.write(
      `Playwright did not discover ${missingFiles.length} ${label} suite(s):\n${missingFiles
        .map((path) => `- ${path}`)
        .join('\n')}\n`,
    );
    process.exit(1);
  }
}
