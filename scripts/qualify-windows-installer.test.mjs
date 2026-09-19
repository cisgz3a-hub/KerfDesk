import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./qualify-windows-installer.ps1', import.meta.url));

function rejectedRun(overrides, escapeEvidence = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'kerfdesk-installer-guard-'));
  const evidence = escapeEvidence
    ? path.join(root, '..', 'outside-evidence')
    : path.join(root, 'evidence');
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Installer',
        path.join(root, 'nonexistent-N.exe'),
        '-UpgradeInstaller',
        path.join(root, 'nonexistent-N-plus-one.exe'),
        '-Version',
        '0.0.0-test.1',
        '-UpgradeVersion',
        '0.0.0-test.2',
        '-SourceCommit',
        'a'.repeat(40),
        '-EvidenceRoot',
        evidence,
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
        env: {
          ...process.env,
          OS: 'Windows_NT',
          GITHUB_ACTIONS: 'false',
          RUNNER_ENVIRONMENT: '',
          RUNNER_TEMP: root,
          GITHUB_WORKSPACE: root,
          ...overrides,
        },
      },
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.equal(
      existsSync(path.join(root, 'evidence')),
      false,
      'must reject before creating evidence',
    );
    return `${result.stdout}\n${result.stderr}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  'installer qualification refuses a developer machine before any filesystem mutation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(rejectedRun({}), /requires a disposable GitHub-hosted Windows runner/u);
  },
);

test(
  'installer qualification refuses persistent/self-hosted runners',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }),
      /requires a disposable/u,
    );
  },
);

test(
  'installer qualification refuses a non-Windows runner',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ OS: 'Linux', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }),
      /requires a disposable/u,
    );
  },
);

test(
  'installer qualification rejects evidence paths outside the checked-out workspace',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, true),
      /outside its owned parent/u,
    );
  },
);
