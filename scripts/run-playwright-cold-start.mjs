import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteCache = resolve(projectRoot, 'node_modules', '.vite');

await rm(viteCache, { recursive: true, force: true });

const windows = process.platform === 'win32';
const child = spawn(
  windows ? (process.env['ComSpec'] ?? 'cmd.exe') : 'pnpm',
  windows
    ? ['/d', '/s', '/c', 'pnpm exec playwright test e2e/cold-start-variable-text.spec.ts']
    : ['exec', 'playwright', 'test', 'e2e/cold-start-variable-text.spec.ts'],
  {
    cwd: projectRoot,
    env: { ...process.env, PLAYWRIGHT_COLD_CACHE: '1' },
    stdio: 'inherit',
  },
);

child.once('error', (error) => {
  process.stderr.write(`cold Playwright startup failed: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
