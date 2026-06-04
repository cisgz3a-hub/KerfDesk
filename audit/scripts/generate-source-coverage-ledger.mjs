import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT_PATH = 'audit/findings/source-coverage-ledger-2026-06-04.json';

function gitLines(args) {
  const raw = execFileSync('git', args, { encoding: 'utf8' });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function classifyLayer(file) {
  if (file.startsWith('src/core/')) return 'core';
  if (file.startsWith('src/io/')) return 'io';
  if (file.startsWith('src/platform/')) return 'platform';
  if (file.startsWith('src/ui/')) return 'ui';
  if (file.startsWith('src/__fixtures__/')) return 'fixture';
  return 'other';
}

function classifyCriticality(file) {
  if (file.includes('/controllers/') || file.includes('/laser/') || file.includes('/output/')) {
    return 'safety-critical';
  }
  if (file.includes('/raster/') || file.includes('/trace/') || file.includes('/job/')) {
    return 'burn-fidelity-critical';
  }
  if (file.includes('/svg/') || file.includes('/project/') || file.includes('/platform/')) {
    return 'import-platform-critical';
  }
  if (file.includes('/workspace/') || file.includes('/layers/')) {
    return 'operator-workflow-critical';
  }
  return 'standard';
}

function classifyKind(file) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return 'test';
  if (file.includes('/__fixtures__/')) return 'fixture';
  if (file.endsWith('.tsx')) return 'react';
  if (file.endsWith('.ts')) return 'typescript';
  return 'other';
}

function siblingTestFor(file, tracked) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return null;
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return null;
  const withoutExt = file.replace(/\.(ts|tsx)$/, '');
  const candidates = [`${withoutExt}.test.ts`, `${withoutExt}.test.tsx`];
  return candidates.find((candidate) => tracked.has(candidate)) ?? null;
}

function summarizeBy(entries, key) {
  const counts = {};
  for (const entry of entries) {
    const value = entry[key];
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

const files = gitLines(['ls-files', 'src']);
const tracked = new Set(files);
const entries = files.map((file) => {
  const normalized = file.replaceAll('\\', '/');
  return {
    file: normalized,
    layer: classifyLayer(normalized),
    kind: classifyKind(normalized),
    criticality: classifyCriticality(normalized),
    directSiblingTest: siblingTestFor(normalized, tracked),
  };
});

const sourceEntries = entries.filter(
  (entry) => entry.kind === 'typescript' || entry.kind === 'react',
);
const missingDirectSiblingTests = sourceEntries
  .filter((entry) => entry.directSiblingTest === null)
  .map((entry) => entry.file);

const ledger = {
  generatedAt: new Date().toISOString(),
  repo: 'LaserForge-2.0',
  scope: 'git ls-files src',
  totals: {
    files: entries.length,
    sourceFiles: sourceEntries.length,
    tests: entries.filter((entry) => entry.kind === 'test').length,
    missingDirectSiblingTests: missingDirectSiblingTests.length,
  },
  byLayer: summarizeBy(entries, 'layer'),
  byCriticality: summarizeBy(entries, 'criticality'),
  missingDirectSiblingTests,
  entries,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
