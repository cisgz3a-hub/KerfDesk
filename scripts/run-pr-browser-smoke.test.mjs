import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

import {
  PR_SMOKE_CORE,
  selectSpecs,
  specFilesOfListing,
  specsNamingChangedFixtures,
} from './run-pr-browser-smoke.mjs';

test('a changed browser fixture selects the specs that load it, through other fixtures too', () => {
  const sources = new Map([
    ['e2e/tools-ai-audit.e2e.ts', "await page.goto('/e2e/fixtures/tools-ai-audit.html');"],
    ['e2e/fixtures/tools-ai-audit.html', '<script type="module" src="./tools-ai-audit.tsx">'],
    ['e2e/fixtures/tools-ai-audit.tsx', 'export {};'],
    ['e2e/composed-svg-roundtrip.e2e.ts', "readFixture('composed-svg', name)"],
    ['e2e/fixtures/composed-svg/circle.svg.json', '{}'],
    ['e2e/unrelated.spec.ts', 'nothing here'],
  ]);
  // The tsx is loaded by the page, never imported by the test process.
  assert.deepEqual(specsNamingChangedFixtures(['e2e/fixtures/tools-ai-audit.tsx'], sources), [
    'e2e/tools-ai-audit.e2e.ts',
  ]);
  // A data file is selected by the folder the spec names.
  assert.deepEqual(
    specsNamingChangedFixtures(['e2e/fixtures/composed-svg/circle.svg.json'], sources),
    ['e2e/composed-svg-roundtrip.e2e.ts'],
  );
  // Changed specs and paths outside e2e/ are left to Playwright's own selection.
  assert.deepEqual(
    specsNamingChangedFixtures(['e2e/unrelated.spec.ts', 'src/ui/app/main.tsx'], sources),
    [],
  );
});

// ADR-647: a pull request's Chrome UX smoke runs fixed core specs and the specs
// it changed; pushes to main and every other event run the whole suite.

test('every core spec exists and belongs to the development browser suite', () => {
  assert.ok(PR_SMOKE_CORE.length >= 8);
  assert.equal(new Set(PR_SMOKE_CORE).size, PR_SMOKE_CORE.length);
  for (const spec of PR_SMOKE_CORE) {
    assert.match(spec, /^e2e\/[\w-]+\.(?:e2e|spec)\.ts$/u);
    assert.ok(existsSync(spec), `${spec} exists`);
    assert.notEqual(spec, 'e2e/production-bundle.spec.ts');
  }
});

test('changed specs join the core once each, in a stable order', () => {
  const listing = {
    suites: [
      { file: 'workbench.e2e.ts' },
      { file: 'tools-vector-audit.e2e.ts' },
      { file: 'sub\\a.spec.ts' },
    ],
  };
  const changed = specFilesOfListing(listing);
  assert.deepEqual(changed, [
    'e2e/workbench.e2e.ts',
    'e2e/tools-vector-audit.e2e.ts',
    'e2e/sub/a.spec.ts',
  ]);
  const selected = selectSpecs(PR_SMOKE_CORE, changed);
  assert.deepEqual(selected.slice(0, PR_SMOKE_CORE.length), PR_SMOKE_CORE);
  assert.equal(selected.filter((spec) => spec === 'e2e/workbench.e2e.ts').length, 1);
  assert.ok(selected.includes('e2e/tools-vector-audit.e2e.ts'));
  assert.deepEqual(specFilesOfListing({}), []);
});

test('pull requests run the core job; every other event runs the whole suite in shards', async () => {
  const e2e = load(await readFile('.github/workflows/e2e.yml', 'utf8'), { schema: JSON_SCHEMA });
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['test:e2e:pull-request'],
    'node scripts/run-pr-browser-smoke.mjs',
  );

  const { suite, checks, chrome } = e2e.jobs;
  const pullRequest = e2e.jobs['pull-request-suite'];
  assert.equal(suite.if, "github.event_name != 'pull_request'");
  assert.equal(pullRequest.if, "github.event_name == 'pull_request'");
  // The checks that run once, production bundle included, run for every event.
  assert.equal(checks.if, undefined);

  const runs = pullRequest.steps.map((step) => step.run).filter(Boolean);
  assert.ok(runs.indexOf('pnpm test:e2e:cold') >= 0);
  assert.ok(runs.indexOf('pnpm test:e2e:cold') < runs.indexOf('pnpm test:e2e:pull-request HEAD^1'));
  // The merge commit's first parent is the base the changed specs are found from.
  const checkout = pullRequest.steps.find((step) =>
    String(step.uses).startsWith('actions/checkout@'),
  );
  assert.equal(checkout.with['fetch-depth'], 2);

  // The gate lets only the suite job this event does not use be skipped.
  assert.deepEqual([...chrome.needs].sort(), ['checks', 'pull-request-suite', 'suite']);
  const verdict = chrome.steps.find((step) => step.id === 'browser_smoke');
  assert.equal(
    verdict.env.UNSELECTED_SUITE,
    "${{ github.event_name == 'pull_request' && 'suite' || 'pull-request-suite' }}",
  );
  assert.match(
    verdict.run,
    /select\(\.value\.result != "success" and \(\.key != \$unselected or \.value\.result != "skipped"\)\)/u,
  );
});
