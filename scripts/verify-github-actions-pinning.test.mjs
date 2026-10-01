import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  REVIEWED_ACTIONS,
  verifyWorkflowDirectory,
  verifyWorkflowText,
} from './verify-github-actions-pinning.mjs';

test('all checked-in workflow actions use reviewed full SHAs', () => {
  assert.deepEqual(verifyWorkflowDirectory(process.cwd()), []);
});

test('mutable, unreviewed, and changed full-SHA references fail independently', () => {
  const checkout = REVIEWED_ACTIONS.get('actions/checkout');
  assert.ok(checkout);
  const failures = verifyWorkflowText(
    'fixture.yml',
    [
      'steps:',
      '  - uses: actions/checkout@v7',
      '  - uses: unknown/example@1111111111111111111111111111111111111111',
      '  - uses: actions/checkout@1111111111111111111111111111111111111111',
      `  - uses: actions/checkout@${checkout}`,
      '  - uses: ./local-action',
    ].join('\n'),
  );
  assert.equal(failures.length, 3);
  assert.match(failures[0] ?? '', /full 40-character commit SHA/u);
  assert.match(failures[1] ?? '', /not reviewed\/allowlisted/u);
  assert.match(failures[2] ?? '', /not the reviewed allowlisted SHA/u);
});

test('local composite actions cannot hide an unpinned external action', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-actions-test-'));
  try {
    const actionPath = path.join(temporaryRoot, '.github', 'actions', 'nested', 'action.yml');
    fs.mkdirSync(path.dirname(actionPath), { recursive: true });
    fs.writeFileSync(
      actionPath,
      'runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@v6\n',
    );
    const failures = verifyWorkflowDirectory(temporaryRoot);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /nested.*action.yml.*full 40-character commit SHA/u);
  } finally {
    const absolute = path.resolve(temporaryRoot);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('kerfdesk-actions-test-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});
