import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const VERIFY_STEP = '      - name: Verify the published immutable release and exact source';
const RUN_BLOCK = '        run: |';
const NEXT_STEP = '      - name:';
const RUN_INDENT = 10;
const SHELL_TEST_TIMEOUT_MS = 15_000;

function finalVerifierScript(): string {
  const lines = readFileSync(
    join(process.cwd(), '.github/workflows/release-desktop-preview.yml'),
    'utf8',
  )
    .replaceAll('\r\n', '\n')
    .split('\n');
  const stepIndex = lines.indexOf(VERIFY_STEP);
  const runIndex = lines.indexOf(RUN_BLOCK, stepIndex + 1);
  if (stepIndex < 0 || runIndex < 0) {
    throw new Error('Preview release verifier shell block is missing');
  }
  const nextStepIndex = lines.findIndex(
    (line, index) => index > runIndex && line.startsWith(NEXT_STEP),
  );
  const endIndex = nextStepIndex < 0 ? lines.length : nextStepIndex;
  return `${lines
    .slice(runIndex + 1, endIndex)
    .map((line) => line.slice(RUN_INDENT))
    .join('\n')}\n`;
}

describe('Desktop Preview release shell', () => {
  it(
    'keeps the post-publication verifier valid Bash',
    () => {
      const result = spawnSync('bash', ['-n', '-s'], {
        encoding: 'utf8',
        input: finalVerifierScript(),
        timeout: SHELL_TEST_TIMEOUT_MS,
      });
      expect(result.status, result.stderr).toBe(0);
    },
    SHELL_TEST_TIMEOUT_MS,
  );
});
