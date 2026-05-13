/**
 * T1-239: F-017 follow-up.
 *
 * The 2026-05-13 audit addendum split the React hook warnings out from the
 * stale-disable cleanup. This test keeps that split honest: app/UI hook
 * dependency warnings must stay at zero after the triage pass.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

interface EslintMessage {
  ruleId: string | null;
  message: string;
  line: number;
  column: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

test('react hook dependency warnings stay triaged', () => {
  const stdout = execFileSync(
    process.execPath,
    ['node_modules/eslint/bin/eslint.js', '.', '--format', 'json', '--max-warnings', '999'],
    { encoding: 'utf8' },
  );
  const results = JSON.parse(stdout) as EslintFileResult[];
  const hookWarnings = results.flatMap(result =>
    result.messages
      .filter(message => message.ruleId === 'react-hooks/exhaustive-deps')
      .map(message => `${result.filePath}:${message.line}:${message.column} ${message.message}`),
  );

  assert.deepEqual(hookWarnings, []);
});
