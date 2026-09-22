// The gate is worthless if it cannot parse the files it guards. Git checks
// DECISIONS.md out as CRLF on Windows (`text=auto eol=lf` stores LF, worktree
// gets CRLF), and a heading pattern anchored with `$` cannot match a line that
// still carries its `\r`. When that happened the gate reported "0 decisions"
// and exited 0 — a green light over three real collisions. These tests run the
// gate as a process against both line endings so a silent pass fails loudly.
//
// Since ADR-344 the gate reads TWO sources — the historical DECISIONS.md and
// one file per decision under docs/decisions/ — so numbering has to stay global
// across the split. A gate that only looked at one of them would hand out a
// number already taken in the other.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Run the gate in a throwaway repo. `files` maps a docs/decisions/ filename to
 * its lines, so a case can place decisions in either source or both.
 */
function runGate(lines, newline, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-gate-'));
  writeFileSync(join(dir, 'DECISIONS.md'), lines.join(newline));
  const entries = Object.entries(files);
  if (entries.length > 0) {
    const decisionDir = join(dir, 'docs', 'decisions');
    mkdirSync(decisionDir, { recursive: true });
    for (const [name, body] of entries) {
      writeFileSync(join(decisionDir, name), body.join(newline));
    }
  }
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

  test(`counts decisions from both sources in a ${label} checkout`, () => {
    const { code, output } = runGate(UNIQUE_DECISIONS, newline, {
      'ADR-3-split-entry.md': ['## ADR-3 - A split decision', ''],
    });
    assert.equal(code, 0);
    assert.match(output, /3 decisions/);
    assert.match(output, /Next free number: ADR-4\./);
  });

  test(`catches a number claimed in both sources in a ${label} checkout`, () => {
    const { code, output } = runGate(UNIQUE_DECISIONS, newline, {
      'ADR-2-collides-with-legacy.md': ['## ADR-2 - Same number, different decision', ''],
    });
    assert.equal(code, 1);
    assert.match(output, /ADR-2 claimed 2x/);
    // Naming BOTH locations is the point; a duplicate is unfixable otherwise.
    assert.match(output, /DECISIONS\.md:3/);
    assert.match(output, /ADR-2-collides-with-legacy\.md:1/);
  });

  test(`lets a split amendment re-use its number in a ${label} checkout`, () => {
    const { code, output } = runGate(UNIQUE_DECISIONS, newline, {
      'ADR-2-amendment-1-refines-it.md': ['## ADR-2 Amendment 1 - Refinement', ''],
    });
    assert.equal(code, 0);
    assert.match(output, /2 decisions \(\+1 amendment\)/);
  });
}

test('rejects a decision file whose heading disagrees with its filename', () => {
  const { code, output } = runGate(UNIQUE_DECISIONS, '\n', {
    'ADR-9-mislabelled.md': ['## ADR-8 - Heading says something else', ''],
  });
  assert.equal(code, 1);
  assert.match(output, /heading says ADR-8, filename says ADR-9/);
});

test('rejects a decision file that is not named for any ADR', () => {
  const { code, output } = runGate(UNIQUE_DECISIONS, '\n', {
    'notes-about-a-decision.md': ['## ADR-5 - Hidden in an unnamed file', ''],
  });
  assert.equal(code, 1);
  assert.match(output, /expected ADR-<number>/);
});

test('still passes on a legacy-only checkout with no decisions directory', () => {
  const { code, output } = runGate(UNIQUE_DECISIONS, '\n');
  assert.equal(code, 0);
  assert.match(output, /2 decisions/);
});
