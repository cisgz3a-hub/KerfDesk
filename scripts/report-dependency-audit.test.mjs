import assert from 'node:assert/strict';
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
