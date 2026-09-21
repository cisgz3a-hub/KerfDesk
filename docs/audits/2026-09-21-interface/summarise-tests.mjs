// Run from the repository root after the four independent audit runs finish.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import prettier from 'prettier';

const directory = path.join(process.cwd(), 'docs/audits/2026-09-21-interface');
const reportFiles = [
  'functional-tests.json',
  'functional-rerun.json',
  'remaining-functional-tests.json',
  'audit-regressions.json',
];
const assertions = new Map();
const runs = reportFiles.map((file) => ({
  file,
  report: JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')),
}));
for (const { file: reportFile, report } of runs.sort(
  (a, b) => a.report.startTime - b.report.startTime,
)) {
  for (const suite of report.testResults) {
    const file = suite.name.replaceAll('\\', '/').replace(/^.*\/src\//, 'src/');
    const occurrences = new Map();
    for (const assertion of suite.assertionResults) {
      const occurrence = (occurrences.get(assertion.fullName) ?? 0) + 1;
      occurrences.set(assertion.fullName, occurrence);
      assertions.set(`${file}::${assertion.fullName}::${occurrence}`, {
        file,
        area: file.split('/')[2],
        name: assertion.fullName,
        occurrence,
        status: assertion.status,
        reportFile,
      });
    }
  }
}
const inventory = JSON.parse(fs.readFileSync(path.join(directory, 'buttons.json'), 'utf8'));
const all = [...assertions.values()];
const areas = Object.entries(inventory.metadata.definitionsByArea).map(([area, sourceRecords]) => {
  const entries = all.filter((entry) => entry.area === area);
  return {
    area,
    sourceRecords,
    testedFiles: new Set(entries.map((entry) => entry.file)).size,
    distinctAssertions: entries.length,
    latestPassed: entries.filter((entry) => entry.status === 'passed').length,
    retainedFailures: entries.filter((entry) => entry.status !== 'passed'),
  };
});
const summary = {
  scope:
    'Independent button-audit runs only. Root-owned machine, shell, workspace, browser and build checks are documented separately.',
  method:
    'Latest result per source file, full assertion name and repeated-name ordinal. Repeated parameterised names remain distinct.',
  runs: runs.map(({ file, report }) => ({
    file,
    testFiles: report.testResults.length,
    assertions: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    success: report.success,
  })),
  distinctAssertions: all.length,
  latestPassed: all.filter((entry) => entry.status === 'passed').length,
  retainedFailures: all.filter((entry) => entry.status !== 'passed'),
  externalResolution:
    'The retained old CommandShell Text-toolbar locator failure is resolved by the separately documented workspace.md targeted rerun. It is not rewritten as a pass in these raw audit logs.',
  areas,
};
fs.writeFileSync(
  path.join(directory, 'button-test-evidence.json'),
  await prettier.format(JSON.stringify(summary), {
    ...(await prettier.resolveConfig(path.join(directory, 'button-test-evidence.json'))),
    parser: 'json',
  }),
);
const markdown = [
  '# Functional evidence by interface area',
  '',
  summary.scope,
  '',
  `These runs contain **${summary.distinctAssertions} distinct assertions** after accounting for reruns. Their latest raw records contain **${summary.latestPassed} passes** and **${summary.retainedFailures.length} retained failure**. ${summary.externalResolution}`,
  '',
  'An assertion may test several controls or an underlying store. These counts are not per-button coverage or hardware qualification.',
  '',
  '| Area | Source records | Tested files in these runs | Distinct assertions | Latest raw passes |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...areas.map(
    (area) =>
      `| ${area.area} | ${area.sourceRecords} | ${area.testedFiles} | ${area.distinctAssertions} | ${area.latestPassed} |`,
  ),
  '',
  'The zero-test rows for common, laser and workspace refer to this independent subset. [Workspace verification](workspace.md) and [completed-job verification](completion.md) are separate. The integrating audit also records machine controls, browser interaction, screenshots and build checks.',
  '',
  '## Retained run reports',
  '',
  '| Run | Files | Assertions | Passed | Failed |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...summary.runs.map(
    (run) =>
      `| [${run.file}](${run.file}) | ${run.testFiles} | ${run.assertions} | ${run.passed} | ${run.failed} |`,
  ),
  '',
  'All five original geometry/tutorial timeout assertions passed on the targeted rerun; the worker-termination case also passed. No tests were skipped to obtain those results. The original reports remain available.',
  '',
  'Rebuild with `node docs/audits/2026-09-21-interface/summarise-tests.mjs` after regenerating the source inventory. [Detailed summary](button-test-evidence.json) retains the unresolved raw-record pointer and its separately documented resolution.',
  '',
];
fs.writeFileSync(
  path.join(directory, 'button-test-evidence.md'),
  await prettier.format(markdown.join('\n'), {
    ...(await prettier.resolveConfig(path.join(directory, 'button-test-evidence.md'))),
    parser: 'markdown',
  }),
);
console.log(
  JSON.stringify({
    distinctAssertions: summary.distinctAssertions,
    latestPassed: summary.latestPassed,
    retainedFailures: summary.retainedFailures.length,
  }),
);
