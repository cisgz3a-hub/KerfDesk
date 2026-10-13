import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { format } from 'prettier';

const directory = new URL('./', import.meta.url);
const root = new URL('../../../../', import.meta.url);
const read = (name) => readFileSync(new URL(name, directory), 'utf8').replace(/^\uFEFF/, '');
const jsonl = (name) => read(name).trim().split(/\r?\n/).map(JSON.parse);
const write = async (name, value) =>
  writeFileSync(new URL(name, directory), await format(JSON.stringify(value), { parser: 'json' }));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const tests = new Map();
const files = new Set();
const reports = [];
for (const name of readdirSync(directory).filter((name) => name.endsWith('-results.json'))) {
  const result = JSON.parse(read(name));
  assert.equal(result.success, true, name);
  assert.equal(result.numFailedTests, 0, name);
  reports.push({ name, passed: result.numPassedTests, pending: result.numPendingTests });
  for (const file of result.testResults) {
    files.add(file.name);
    file.assertionResults.forEach((test, index) => {
      const key = `${file.name}:${index}:${test.fullName}`;
      if (tests.get(key) !== 'passed') tests.set(key, test.status);
    });
  }
}
assert.ok(reports.length >= 9, 'All planned test reports must exist.');
assert.ok([...tests.values()].every((status) => status === 'passed'));

const events = jsonl('large-paths-results.jsonl');
const configuration = events.find((event) => event.event === 'configuration');
const summary = events.find((event) => event.event === 'summary');
assert.equal(summary.passedFixtures, 36);
assert.equal(summary.passedRouteCases, 72);
assert.equal(summary.failedFixtures + summary.timedOutFixtures, 0);
const routes = events.filter((event) => event.event === 'route-case');
const ranges = new Map();
for (const route of routes) {
  const key = `${route.count}/${route.pattern}`;
  const range = ranges.get(key) ?? [];
  range.push(route.elapsedMs);
  ranges.set(key, range);
}
const oldRoutes = jsonl('../large-paths-results.jsonl').filter(
  (event) => event.event === 'route-case',
);
for (const old of oldRoutes) {
  const next = routes.find(
    (route) =>
      route.count === old.count &&
      route.seed === old.seed &&
      route.pattern === old.pattern &&
      route.direction === old.direction,
  );
  assert.ok(next);
  assert.equal(next.travelMm, old.travelMm, 'Travel must match before the repair.');
}

await write('verification-summary.json', {
  baseCommit: 'c700863a14dfbed71a49e32182ec3b75b989ebb1',
  distinctPassedTests: tests.size,
  distinctFiles: files.size,
  reports,
  configuration,
  summary,
  beforeAndAfterEqualTravelCases: oldRoutes.length,
  optimizerFirstCallRanges: [...ranges].map(([fixture, values]) => ({
    fixture,
    calls: values.length,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  })),
  qualification: 'Software-only. Timing observations are planning time, not machine job time.',
});
const sources = [
  'src/core/job/segment-entry-index.ts',
  'src/core/job/segment-entry-index-coincident.test.ts',
  'scripts/stress-quality-first-paths.mjs',
];
const hashes = Object.fromEntries(
  sources.map((path) => [path, sha256(readFileSync(new URL(path, root)))]),
);
for (const name of readdirSync(directory).filter(
  (name) => name !== 'sha256.json' && !name.endsWith('.log'),
)) {
  hashes[name] = sha256(readFileSync(new URL(name, directory)));
}
await write('sha256.json', hashes);
console.log(
  `Verified ${tests.size} unique tests in ${files.size} files and 72 stress route cases.`,
);
console.log(fileURLToPath(new URL('verification-summary.json', directory)));
