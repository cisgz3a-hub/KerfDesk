/**
 * T1-243: the T3-81 integration suite must terminate when spawned by
 * scripts/run-tests.mjs. It used to print all 40 passing assertions and
 * then hang until the runner killed it because the test called
 * process.exit() immediately after a large stdout burst on Windows.
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('T3-81 end-to-end workflow suite exits when runner-spawned', async () => {
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; output: string }>((resolve) => {
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      'tests/end-to-end-workflows/end-to-end-workflows.test.ts',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LASERFORGE_DETERMINISTIC_IDS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15_000);

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, timedOut, output });
    });
  });

  assert.equal(result.timedOut, false, result.output);
  assert.equal(result.signal, null, result.output);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Result: 40 passed, 0 failed/);
});
