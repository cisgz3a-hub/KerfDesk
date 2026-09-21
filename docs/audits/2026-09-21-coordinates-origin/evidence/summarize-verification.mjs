import fs from 'node:fs';
import path from 'node:path';
const evidence = 'docs/audits/2026-09-21-coordinates-origin/evidence';
const files = new Map();
const canonical = (name) => name.replaceAll('\\', '/').replace(/^.*?\/src\//, 'src/');
function addLog(name, stage) {
  const log = fs.readFileSync(path.join(evidence, name), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  let matched = 0;
  for (const m of log.matchAll(/(?:✓|✔)\s+(src\/\S+\.test\.tsx?)\s+\((\d+) tests?\)/g)) {
    files.set(canonical(m[1]), {
      name: canonical(m[1]),
      tests: Number(m[2]),
      status: 'passed',
      evidence: name,
      stage,
    });
    matched++;
  }
  return matched;
}
function addJson(name) {
  const data = JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
  if (!data.success || data.numFailedTests || data.numPendingTests || data.numTodoTests) {
    throw new Error(`Incomplete or failing verification: ${name}`);
  }
  for (const result of data.testResults) {
    files.set(canonical(result.name), {
      name: canonical(result.name),
      tests: result.assertionResults.length,
      status: result.status,
      evidence: name,
      stage: 'post-repair',
    });
  }
  return {
    files: data.testResults.length,
    tests: data.numTotalTests,
    passed: data.numPassedTests,
    failed: data.numFailedTests,
  };
}
const parsedLogs = {
  originBaseline: addLog('origin-existing-tests.log', 'baseline'),
  originOracle: addLog('origin-oracle-and-selectors.log', 'baseline'),
  geometryBaseline: addLog('coordinate-baseline-tests.txt', 'unchanged-geometry'),
  geometryFinal: addLog('coordinate-final-separated-tests.txt', 'unchanged-geometry'),
};
const cohorts = {
  frameStart: addJson('frame-start-final-results.json'),
  settings: addJson('settings-final-tests.json'),
  origin: addJson('origin-final-tests.json'),
  additionalOriginIntegration: addJson('origin-integration-additional.json'),
};
const latestOrigin = JSON.parse(
  fs.readFileSync(path.join(evidence, 'origin-latest-per-file.json'), 'utf8'),
);
for (const result of latestOrigin) {
  if (result.status !== 'passed') throw new Error(`Failed latest origin file: ${result.name}`);
  files.set(canonical(result.name), {
    ...result,
    name: canonical(result.name),
    stage: 'post-repair',
  });
}
cohorts.origin = {
  files: latestOrigin.length,
  tests: latestOrigin.reduce((sum, file) => sum + file.tests, 0),
  passed: latestOrigin.reduce((sum, file) => sum + file.tests, 0),
  failed: 0,
  evidence: 'origin-latest-per-file.json',
};
const entries = [...files.values()].sort((a, b) => a.name.localeCompare(b.name));
const total = entries.reduce((sum, f) => sum + f.tests, 0);
const summary = {
  base: '288ad66baf23e0c75c0a05f6216787577ddc6812',
  uniqueFiles: entries.length,
  assertions: total,
  correctnessChecks: total - 3,
  openDefectCharacterisations: 3,
  parsedLogs,
  cohorts,
  files: entries,
};
fs.writeFileSync(
  path.join(evidence, 'verification-summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(JSON.stringify({ ...summary, files: undefined }, null, 2));
