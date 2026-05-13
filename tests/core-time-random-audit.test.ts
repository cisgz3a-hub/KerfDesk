/**
 * T1-235: per-site review for Date.now() / Math.random() in src/core.
 *
 * F-008 is an architecture/determinism finding, not a request to delete every
 * timestamp. This source-level test pins the review outcome:
 * - deterministic compile/output paths stay free of wall-clock and random input;
 * - critical ID generators keep deterministic-mode guards;
 * - remaining core callsites are either diagnostic/history metadata or deferred
 *   inline ID generators for T1-236 / F-013.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { test } from 'node:test';

type Token = 'Date.now' | 'Math.random' | 'performance.now';

interface Occurrence {
  file: string;
  line: number;
  token: Token;
  text: string;
}

const expectedCounts: Record<string, Partial<Record<Token, number>>> = {
  'src/core/job/JobLog.ts': { 'Date.now': 4 },
  'src/core/job/ticketHashing.ts': { 'Date.now': 1, 'Math.random': 1 },
  'src/core/logging/StructuredDiagnosticLog.ts': { 'Date.now': 2 },
  'src/core/replay/JobReplay.ts': { 'Date.now': 2 },
  'src/core/types.ts': { 'Date.now': 1, 'Math.random': 1 },
};

const deterministicPathFiles = [
  'src/core/job/JobCompiler.ts',
  'src/core/output/Output.ts',
  'src/core/plan/PathOptimizer.ts',
  'src/core/plan/PlanOptimizer.ts',
  'src/core/plan/MachineTransform.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
      continue;
    }
    if (entry.isFile() && extname(entry.name) === '.ts') {
      out.push(path);
    }
  }
  return out;
}

function normalizePath(path: string): string {
  return relative('.', path).split(sep).join('/');
}

function collectOccurrences(files: string[]): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const path of files) {
    const file = normalizePath(path);
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      for (const token of ['Date.now', 'Math.random', 'performance.now'] as const) {
        const tokenIndex = line.indexOf(`${token}(`);
        const lineCommentIndex = line.indexOf('//');
        if (tokenIndex >= 0 && (lineCommentIndex < 0 || tokenIndex < lineCommentIndex)) {
          occurrences.push({ file, line: idx + 1, token, text: line.trim() });
        }
      }
    });
  }
  return occurrences;
}

const coreFiles = walk('src/core');
const occurrences = collectOccurrences(coreFiles);

test('all core Date.now / Math.random callsites are reviewed', () => {
  const actual = new Map<string, Map<Token, number>>();
  for (const occurrence of occurrences) {
    const byToken = actual.get(occurrence.file) ?? new Map<Token, number>();
    byToken.set(occurrence.token, (byToken.get(occurrence.token) ?? 0) + 1);
    actual.set(occurrence.file, byToken);
  }

  const expectedKeys = new Set(Object.keys(expectedCounts));
  const unexpected = [...actual.keys()].filter(file => !expectedKeys.has(file));
  assert.deepEqual(unexpected, [], `unreviewed files: ${unexpected.join(', ')}`);

  for (const [file, byToken] of actual) {
    const expected = expectedCounts[file] ?? {};
    for (const token of ['Date.now', 'Math.random', 'performance.now'] as const) {
      assert.equal(
        byToken.get(token) ?? 0,
        expected[token] ?? 0,
        `${file} ${token} count`,
      );
    }
  }
});

test('determinism-sensitive compile paths do not use wall-clock or random input', () => {
  const offenders = collectOccurrences(deterministicPathFiles).map(
    occurrence => `${occurrence.file}:${occurrence.line} ${occurrence.token} ${occurrence.text}`,
  );

  assert.deepEqual(offenders, []);
});

test('performance.now is absent from core after the PathOptimizer fix', () => {
  const offenders = occurrences
    .filter(occurrence => occurrence.token === 'performance.now')
    .map(occurrence => `${occurrence.file}:${occurrence.line}`);

  assert.deepEqual(offenders, []);
});

test('critical random ID surfaces keep deterministic-mode guards', () => {
  const coreTypes = readFileSync('src/core/types.ts', 'utf8');
  assert.match(coreTypes, /LASERFORGE_DETERMINISTIC_IDS/);
  assert.match(coreTypes, /__LF_DETERMINISTIC_IDS__/);
  assert.match(coreTypes, /return `det-\$\{String\(_detCounter\)\.padStart\(6, '0'\)\}`/);

  const ticketHashing = readFileSync('src/core/job/ticketHashing.ts', 'utf8');
  assert.match(ticketHashing, /LASERFORGE_DETERMINISTIC_IDS/);
  assert.match(ticketHashing, /__LF_DETERMINISTIC_IDS__/);
  assert.match(ticketHashing, /return `tkt_det_\$\{String\(ticketSeq\)\.padStart\(6, '0'\)\}`/);
});

test('Math.random is centralized behind deterministic-aware helpers', () => {
  const randomFiles = new Set(
    occurrences
      .filter(occurrence => occurrence.token === 'Math.random')
      .map(occurrence => occurrence.file),
  );

  randomFiles.delete('src/core/types.ts');
  randomFiles.delete('src/core/job/ticketHashing.ts');
  assert.deepEqual(randomFiles, new Set());
});
