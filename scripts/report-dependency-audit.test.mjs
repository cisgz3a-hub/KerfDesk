import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyDependencyAudit, dependencyAuditMarkdown } from './report-dependency-audit.mjs';

test('classifies production, packaged Electron, release-build, and test-only hits separately', () => {
  const full = {
    advisories: {
      1: {
        module_name: 'runtime-package',
        title: 'runtime issue',
        severity: 'high',
        findings: [{ paths: ['.>runtime-package'] }],
      },
      2: {
        module_name: 'tool-package',
        title: 'tool issue',
        severity: 'moderate',
        findings: [{ paths: ['.>vite>tool-package'] }],
      },
      3: {
        module_name: 'electron',
        title: 'desktop runtime issue',
        severity: 'high',
        findings: [{ paths: ['.>electron'] }],
      },
      4: {
        module_name: 'undici',
        title: 'download tool issue',
        severity: 'moderate',
        findings: [{ paths: ['.>electron>@electron/get>undici'] }],
      },
    },
  };
  const runtime = { advisories: { 1: full.advisories['1'] } };
  const report = classifyDependencyAudit(full, runtime);
  assert.equal(report.runtimeCount, 2);
  assert.equal(report.releaseBuildOnlyCount, 1);
  assert.equal(report.buildTestOnlyCount, 1);
  const markdown = dependencyAuditMarkdown(report);
  assert.match(markdown, /Electron host.*devDependency.*product runtime/su);
  assert.match(markdown, /not product-runtime defects/u);
});

test('rejects scanner errors and missing advisory evidence instead of reporting a clean graph', () => {
  const clean = { advisories: {} };
  for (const invalid of [{ error: { code: 'pnpm', message: 'fetch failed' } }, {}, null, []]) {
    assert.throws(() => classifyDependencyAudit(invalid, clean), /full audit/i);
    assert.throws(() => classifyDependencyAudit(clean, invalid), /runtime audit/i);
  }
});

test('accepts advisory exit one but rejects scanner failure and contradictory exit evidence', () => {
  const finding = {
    advisories: { 1: { module_name: 'react', findings: [{ paths: ['.>react'] }] } },
  };
  const clean = { advisories: {} };
  assert.equal(
    classifyDependencyAudit(finding, finding, { fullExit: 1, runtimeExit: 1 }).runtimeCount,
    1,
  );
  assert.equal(
    classifyDependencyAudit(clean, clean, { fullExit: 0, runtimeExit: 0 }).runtimeCount,
    0,
  );
  assert.throws(
    () => classifyDependencyAudit(clean, clean, { fullExit: 1, runtimeExit: 0 }),
    /full audit/i,
  );
  assert.throws(
    () => classifyDependencyAudit(finding, clean, { fullExit: 2, runtimeExit: 0 }),
    /full audit/i,
  );
  assert.throws(
    () => classifyDependencyAudit(clean, clean, { fullExit: '', runtimeExit: 0 }),
    /full audit/i,
  );
});

test('keeps runtime findings even when the two registry snapshots differ', () => {
  const runtime = {
    advisories: { 9: { module_name: 'react', findings: [{ paths: ['.>react'] }] } },
  };
  const report = classifyDependencyAudit({ advisories: {} }, runtime);
  assert.equal(report.runtimeCount, 1);
  assert.equal(report.advisories[0].module, 'react');
});

test('invalid scanner output exits unsuccessfully and leaves an explicit invalid evidence artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-audit-invalid-'));
  const full = path.join(root, 'full.json');
  const runtime = path.join(root, 'runtime.json');
  const output = path.join(root, 'output');
  const githubOutput = path.join(root, 'github-output');
  fs.writeFileSync(full, JSON.stringify({ error: { code: 'pnpm', message: 'fetch failed' } }));
  fs.writeFileSync(runtime, JSON.stringify({ advisories: {} }));
  const result = spawnSync(
    process.execPath,
    [
      'scripts/report-dependency-audit.mjs',
      `--full=${full}`,
      `--runtime=${runtime}`,
      '--full-exit=1',
      '--runtime-exit=0',
      `--output=${output}`,
      `--github-output=${githubOutput}`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  assert.equal(report.evidenceStatus, 'invalid');
  assert.equal(report.runtimeCount, null);
  assert.match(
    fs.readFileSync(path.join(output, 'report.md'), 'utf8'),
    /could not be established/i,
  );
  assert.match(fs.readFileSync(githubOutput, 'utf8'), /evidence_valid=false/);
  assert.doesNotMatch(fs.readFileSync(githubOutput, 'utf8'), /total_count=0/);
});
