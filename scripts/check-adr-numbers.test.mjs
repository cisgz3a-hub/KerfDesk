// The gate is worthless if it cannot parse the file it guards. Git checks
// DECISIONS.md out as CRLF on Windows (`text=auto eol=lf` stores LF, worktree
// gets CRLF), and a heading pattern anchored with `$` cannot match a line that
// still carries its `\r`. When that happened the gate reported "0 decisions"
// and exited 0 — a green light over three real collisions. These tests run the
// gate as a process against both line endings so a silent pass fails loudly.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const GATE = fileURLToPath(new URL('./check-adr-numbers.mjs', import.meta.url));

const UNIQUE_DECISIONS = ['## ADR-1 - First decision', '', '## ADR-2 - Second decision', ''];
const DUPLICATE_DECISIONS = [
  '## ADR-7 - Original decision',
  '',
  '## ADR-7 - Colliding decision',
  '',
];
const WITH_AMENDMENT = ['## ADR-4 - A decision', '', '## ADR-4 Amendment 1 - Refinement', ''];

/** Run the gate in a throwaway directory holding the given DECISIONS.md. */
function runGate(lines, newline) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-gate-'));
  writeFileSync(join(dir, 'DECISIONS.md'), lines.join(newline));
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [GATE], { cwd: dir, encoding: 'utf8' }),
    };
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

for (const [label, newline] of [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
]) {
  test(`counts every decision in a ${label} file`, () => {
    const { code, output } = runGate(UNIQUE_DECISIONS, newline);
    assert.equal(code, 0);
    // The count is the assertion that matters: "0 decisions" passed on every
    // CRLF checkout precisely because parsing nothing looks like success.
    assert.match(output, /2 decisions/);
    assert.match(output, /Next free number: ADR-3\./);
  });

  test(`rejects duplicate numbers in a ${label} file`, () => {
    const { code, output } = runGate(DUPLICATE_DECISIONS, newline);
    assert.equal(code, 1);
    assert.match(output, /ADR-7 claimed 2x/);
  });

  test(`does not count an amendment as a collision in a ${label} file`, () => {
    const { code, output } = runGate(WITH_AMENDMENT, newline);
    assert.equal(code, 0);
    // "decisions" stays plural at any count; only the amendment noun inflects.
    assert.match(output, /1 decisions \(\+1 amendment\)/);
  });
}
