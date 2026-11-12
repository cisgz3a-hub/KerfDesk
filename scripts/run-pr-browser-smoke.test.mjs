import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

import {
  PR_SMOKE_CORE,
  PR_SMOKE_MAX_SPECS,
  pullRequestSuiteFor,
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

// Code-quality audit C2 D7-P2-2: matching bare words cascaded one generator
// script to 141 of 172 specs, and #1730's job ran 476 tests for 2 h 15 m.
test('names match only as whole file names, import specifiers or fixture folders', () => {
  const sources = new Map([
    ['e2e/imports-helper.e2e.ts', "import { open } from './fixtures/save-helper';"],
    ['e2e/imports-helper-js.e2e.ts', "import { open } from './fixtures/save-helper.js';"],
    ['e2e/word-only.e2e.ts', '// save-helper is described in the README'],
    ['e2e/longer-name.e2e.ts', "import { x } from './fixtures/save-helper-extra';"],
    ['e2e/reads-script.e2e.ts', "readFileSync(new URL('./fixtures/grbl.js', import.meta.url))"],
    ['e2e/names-word-grbl.e2e.ts', 'const grbl = connect(); // grbl.jsonl is elsewhere'],
    ['e2e/composed-browser.e2e.ts', "import { x } from './fixtures/composed-svg-browser';"],
    ['e2e/composed.e2e.ts', "readFixture('composed-svg', name)"],
    ['e2e/fixtures/save-helper.ts', 'export const open = 1;'],
    ['e2e/fixtures/grbl.js', 'window.grbl = 1;'],
    ['e2e/fixtures/composed-svg-browser.ts', 'export const x = 1;'],
  ]);
  assert.deepEqual(specsNamingChangedFixtures(['e2e/fixtures/save-helper.ts'], sources), [
    'e2e/imports-helper-js.e2e.ts',
    'e2e/imports-helper.e2e.ts',
  ]);
  // A script is found by its file name with the extension, a full stop
  // ending a sentence aside; "grbl.jsonl" is another file.
  assert.deepEqual(specsNamingChangedFixtures(['e2e/fixtures/grbl.js'], sources), [
    'e2e/reads-script.e2e.ts',
  ]);
  // A data folder is not found inside a longer module name.
  assert.deepEqual(specsNamingChangedFixtures(['e2e/fixtures/composed-svg/a.svg'], sources), [
    'e2e/composed.e2e.ts',
  ]);
});

test('a generic file name needs its folder, and finding one does not cascade', () => {
  const sources = new Map([
    ['e2e/document-import.e2e.ts', "openGenerated(page, 'illustrator-3.ai')"],
    ['e2e/uses-generate.e2e.ts', 'const shapes = generate(4); // generate.mjs'],
    ['e2e/runs-generator.e2e.ts', "execFile('node', ['fixtures/import-generated/generate.mjs'])"],
    [
      'e2e/fixtures/import-generated/generate.mjs',
      "writeFileSync('illustrator-3.ai', bytes); // see generate.mjs",
    ],
  ]);
  // The generator is named only with its folder; the bare word and a bare
  // "generate.mjs" in another file do not select.
  assert.deepEqual(
    specsNamingChangedFixtures(['e2e/fixtures/import-generated/generate.mjs'], sources),
    ['e2e/runs-generator.e2e.ts'],
  );
  // The data file reaches the generator, which names it, but the search does
  // not go on to everything that says "generate".
  const fromData = specsNamingChangedFixtures(
    ['e2e/fixtures/import-generated/illustrator-3.ai'],
    sources,
  );
  assert.ok(fromData.includes('e2e/document-import.e2e.ts'));
  assert.ok(!fromData.includes('e2e/uses-generate.e2e.ts'));
  // A README is documentation.
  assert.deepEqual(
    specsNamingChangedFixtures(
      ['e2e/fixtures/import-generated/README.md', 'e2e/fixtures/Readme.txt'],
      sources,
    ),
    [],
  );
});

function e2eTree(directory = 'e2e') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return e2eTree(path);
    if (!/\.(?:ts|tsx|js|mjs|cjs|html|json|css)$/u.test(entry.name)) return [];
    return [[path, readFileSync(path, 'utf8')]];
  });
}

test('on the real browser suite, the generated import fixtures select a small set', () => {
  const sources = e2eTree();
  const folder = 'e2e/fixtures/document-import-generated';
  for (const changed of [
    [`${folder}/generate.mjs`],
    [`${folder}/illustrator-3.ai`],
    [`${folder}/README.md`, `${folder}/generate.mjs`, `${folder}/illustrator-3.ai`],
  ]) {
    const specs = specsNamingChangedFixtures(changed, sources);
    assert.ok(specs.length <= 5, `${changed.join(', ')} selects ${specs.length}: ${specs}`);
    assert.ok(specs.includes('e2e/document-import-acceptance.e2e.ts'));
  }
  assert.deepEqual(specsNamingChangedFixtures([`${folder}/README.md`], sources), []);
});

test('a selection over the limit runs the whole suite in shards', () => {
  const specs = (count) => Array.from({ length: count }, (_, index) => `e2e/s${index}.e2e.ts`);
  assert.equal(PR_SMOKE_MAX_SPECS, 40);
  assert.equal(pullRequestSuiteFor(specs(PR_SMOKE_CORE.length)), 'focused');
  assert.equal(pullRequestSuiteFor(specs(PR_SMOKE_MAX_SPECS)), 'focused');
  assert.equal(pullRequestSuiteFor(specs(PR_SMOKE_MAX_SPECS + 1)), 'full');
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

test('a pull request plans its suite; every other event runs the whole suite in shards', async () => {
  const e2e = load(await readFile('.github/workflows/e2e.yml', 'utf8'), { schema: JSON_SCHEMA });
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['test:e2e:pull-request'],
    'node scripts/run-pr-browser-smoke.mjs',
  );

  const { plan, suite, checks, chrome } = e2e.jobs;
  const pullRequest = e2e.jobs['pull-request-suite'];
  assert.equal(plan.if, "github.event_name == 'pull_request'");
  assert.equal(plan.outputs.suite, '${{ steps.plan.outputs.suite }}');
  const planStep = plan.steps.find((step) => step.id === 'plan');
  assert.equal(planStep.run, 'pnpm test:e2e:pull-request HEAD^1 --plan');
  // The shards run outside a pull request, where the plan is skipped, and on
  // a pull request whose selection is over the limit.
  assert.equal(suite.needs, 'plan');
  assert.equal(
    suite.if,
    "${{ !cancelled() && (github.event_name != 'pull_request' || needs.plan.outputs.suite == 'full') }}",
  );
  assert.equal(pullRequest.needs, 'plan');
  assert.equal(
    pullRequest.if,
    "github.event_name == 'pull_request' && needs.plan.outputs.suite == 'focused'",
  );
  // The checks that run once, production bundle included, run for every event.
  assert.equal(checks.if, undefined);

  const runs = pullRequest.steps.map((step) => step.run).filter(Boolean);
  assert.ok(runs.indexOf('pnpm test:e2e:cold') >= 0);
  assert.ok(runs.indexOf('pnpm test:e2e:cold') < runs.indexOf('pnpm test:e2e:pull-request HEAD^1'));
  // The merge commit's first parent is the base the changed specs are found from.
  for (const job of [plan, pullRequest]) {
    const checkout = job.steps.find((step) => String(step.uses).startsWith('actions/checkout@'));
    assert.equal(checkout.with['fetch-depth'], 2);
  }

  // The gate lets only the jobs this run does not use be skipped.
  assert.deepEqual([...chrome.needs].sort(), ['checks', 'plan', 'pull-request-suite', 'suite']);
  const verdict = chrome.steps.find((step) => step.id === 'browser_smoke');
  assert.equal(
    verdict.env.SKIPPABLE_JOBS,
    "${{ github.event_name != 'pull_request' && 'plan pull-request-suite' || needs.plan.outputs.suite == 'full' && 'pull-request-suite' || 'suite' }}",
  );
  assert.match(verdict.run, /--arg skippable "\$\{SKIPPABLE_JOBS\}"/u);
});

// The gate's jq filter, run for real where jq is installed (CI's Ubuntu
// runners have it).
test('the gate passes only when every job it may not skip passed', async (t) => {
  if (spawnSync('jq', ['--version']).error !== undefined) {
    t.skip('jq is not installed here');
    return;
  }
  const e2e = load(await readFile('.github/workflows/e2e.yml', 'utf8'), { schema: JSON_SCHEMA });
  const verdict = e2e.jobs.chrome.steps.find((step) => step.id === 'browser_smoke');
  const filter = /jq -r --arg skippable "\$\{SKIPPABLE_JOBS\}" '([^']+)'/u.exec(verdict.run)[1];
  const notPassed = (skippable, results) =>
    spawnSync('jq', ['-r', '--arg', 'skippable', skippable, filter], {
      input: JSON.stringify(
        Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result }])),
      ),
      encoding: 'utf8',
    })
      .stdout.split('\n')
      .filter((line) => line !== '');
  const push = { plan: 'skipped', checks: 'success', suite: 'success' };
  assert.deepEqual(
    notPassed('plan pull-request-suite', { ...push, 'pull-request-suite': 'skipped' }),
    [],
  );
  assert.deepEqual(notPassed('plan pull-request-suite', { ...push, suite: 'skipped' }), [
    'suite: skipped',
  ]);
  const focused = { plan: 'success', checks: 'success', suite: 'skipped' };
  assert.deepEqual(notPassed('suite', { ...focused, 'pull-request-suite': 'success' }), []);
  assert.deepEqual(notPassed('suite', { ...focused, 'pull-request-suite': 'failure' }), [
    'pull-request-suite: failure',
  ]);
  const full = { plan: 'success', checks: 'success', 'pull-request-suite': 'skipped' };
  assert.deepEqual(notPassed('pull-request-suite', { ...full, suite: 'success' }), []);
  // A failed plan runs neither suite job, and the gate names all three.
  assert.deepEqual(
    notPassed('suite', {
      plan: 'failure',
      checks: 'success',
      suite: 'skipped',
      'pull-request-suite': 'skipped',
    }),
    ['plan: failure', 'pull-request-suite: skipped'],
  );
});
