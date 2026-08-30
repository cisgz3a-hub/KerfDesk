import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildReadinessReport,
  normalizeReadinessState,
  readinessMarkdown,
  resolveReadinessSha,
} from './report-release-readiness.mjs';

test('keeps all readiness lanes separate and explicitly nonblocking', () => {
  const report = buildReadinessReport({
    sha: '9209fcb33f4807ebfc1f7a55780069b6a7b0e23c',
    generatedAt: '2026-08-25T00:00:00.000Z',
    states: { ci: 'success', browser: 'failure', deploy: 'skipped' },
  });

  assert.equal(report.policy.blocking, false);
  assert.equal(report.policy.browserGatesDeploy, false);
  assert.deepEqual(Object.fromEntries(report.lanes.map((lane) => [lane.id, lane.state])), {
    ci: 'passed',
    browser: 'failed',
    deploy: 'not-run',
    'packaged-runtime': 'not-run',
    'perceptual-reference-cam': 'not-run',
    hardware: 'not-run',
  });
  assert.match(readinessMarkdown(report), /Commit: `9209fcb/);
});

test('rejects unknown states instead of guessing', () => {
  assert.throws(() => normalizeReadinessState('green-ish'), /unsupported readiness state/);
});

test('uses the checked-out commit instead of workflow event GITHUB_SHA', () => {
  const checkoutSha = '2'.repeat(40);
  assert.equal(
    resolveReadinessSha({
      explicitSha: undefined,
      checkoutSha,
      environmentSha: '1'.repeat(40),
    }),
    checkoutSha,
  );
  assert.equal(
    resolveReadinessSha({
      explicitSha: '3'.repeat(40),
      checkoutSha,
      environmentSha: '1'.repeat(40),
    }),
    '3'.repeat(40),
  );
});

test('workflows do not forward a standalone pnpm separator to the readiness CLI', async () => {
  const workflows = [
    '.github/workflows/ci.yml',
    '.github/workflows/deploy.yml',
    '.github/workflows/e2e.yml',
    '.github/workflows/packaged-native-smoke.yml',
  ];

  for (const path of workflows) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /pnpm report:release-readiness\s*\n(?:\s*--sha=.*\n)?\s*--state=/);
    assert.doesNotMatch(source, /pnpm report:release-readiness --/);
    assert.match(source, /--evidence=/);
  }
});
