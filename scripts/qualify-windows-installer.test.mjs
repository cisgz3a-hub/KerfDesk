import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./qualify-windows-installer.ps1', import.meta.url));

test(
  'sequential fresh and historical qualifications use distinct owned runner roots',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = fileURLToPath(new URL('./installer-qualification-root.ps1', import.meta.url));
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const runnerTemp = path.resolve(tmpdir());
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `. ${quoted(helper)}; @('Launch', 'HistoricalUpgrade', 'Full') | ForEach-Object { Get-InstallerQualificationRoot ${quoted(runnerTemp)} '123456' '2' $_ } | ConvertTo-Json -Compress`,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const roots = JSON.parse(result.stdout);
    assert.equal(
      new Set(roots).size,
      3,
      'Launch must not leave a root that blocks HistoricalUpgrade',
    );
    for (const root of roots)
      assert.equal(path.dirname(root).toLowerCase(), runnerTemp.toLowerCase());
  },
);

function rejectedRun(overrides, escapeEvidence = false, args = []) {
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
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
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
  'production qualification keeps the developer-machine refusal',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({}, false, ['-PackageKind', 'CommercialUnsigned', '-Scenario', 'Launch']),
      /requires a disposable GitHub-hosted Windows runner/u,
    );
  },
);

test(
  'production full qualification refuses unsupported CDP before mutation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, false, [
        '-PackageKind',
        'CommercialUnsigned',
      ]),
      /Full requires CDP, which production packages forbid/u,
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
  'historical qualification cannot run on a developer machine',
  { skip: process.platform !== 'win32' },
  () => {
    assert.match(
      rejectedRun({}, false, [
        '-Scenario',
        'HistoricalUpgrade',
        '-PackageKind',
        'CommercialUnsigned',
        '-UpgradeSourceCommit',
        'b'.repeat(40),
      ]),
      /requires a disposable GitHub-hosted/,
    );
  },
);

test(
  'historical qualification refuses a same-source or unsupported-channel comparison before mutation',
  { skip: process.platform !== 'win32' },
  () => {
    for (const extra of [
      ['-PackageKind', 'CommercialUnsigned', '-UpgradeSourceCommit', 'a'.repeat(40)],
      ['-PackageKind', 'Preview', '-UpgradeSourceCommit', 'b'.repeat(40)],
    ]) {
      assert.match(
        rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, false, [
          '-Scenario',
          'HistoricalUpgrade',
          ...extra,
        ]),
        /distinct commercial versions and exact source commits/,
      );
    }
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

test(
  'normal-profile native driver refuses developer and self-hosted execution before mutation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const driver = fileURLToPath(new URL('./installed-upgrade-profile.ps1', import.meta.url));
    const root = mkdtempSync(path.join(tmpdir(), 'kerfdesk-profile-guard-'));
    const evidence = path.join(root, 'evidence');
    try {
      for (const runner of [
        { GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: '' },
        { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
      ]) {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            driver,
            '-Phase',
            'create',
            '-Executable',
            path.join(root, 'missing.exe'),
            '-EvidenceRoot',
            evidence,
            '-ExpectedProfile',
            path.join(root, 'profile'),
            '-Project',
            path.join(root, 'missing.lf2'),
            '-ExpectedVersion',
            '1.0.2',
            '-ExpectedCommit',
            'a'.repeat(40),
          ],
          {
            encoding: 'utf8',
            timeout: 30_000,
            windowsHide: true,
            env: {
              ...process.env,
              OS: 'Windows_NT',
              RUNNER_TEMP: root,
              GITHUB_WORKSPACE: root,
              ...runner,
            },
          },
        );
        assert.ifError(result.error);
        assert.notEqual(result.status, 0);
        assert.match(
          `${result.stdout}\n${result.stderr}`,
          /requires a disposable GitHub-hosted Windows runner/u,
        );
        assert.equal(existsSync(evidence), false);
        assert.equal(existsSync(path.join(root, 'profile')), false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
