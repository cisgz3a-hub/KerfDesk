import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertBuildMetadata,
  assertEvidencePath,
  assertHostedWindows,
  assertPreflight,
  assertRoundtrip,
  evidenceParents,
  FIXTURE_NAME,
  parseArgs,
  prepareProfile,
  validateProject,
} from './installed-app-evidence.mjs';
import { bounded } from './installed-app-process.mjs';

const ENV = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_RUN_ID: '123',
  RUNNER_TEMP: 'C:\\runner\\temp',
  GITHUB_WORKSPACE: 'D:\\a\\repo\\repo',
};
const ARGV = [
  '--executable',
  'C:\\runner\\temp\\installed\\KerfDesk.exe',
  '--output-root',
  'C:\\runner\\temp\\evidence\\create',
  '--expected-profile',
  'C:\\Users\\runneradmin\\AppData\\Roaming\\laserforge',
  '--phase',
  'create',
  '--project',
  'C:\\runner\\temp\\projects\\test.lf2',
];
const PROBE = {
  appData: 'C:\\Users\\runneradmin\\AppData\\Roaming',
  existingProcesses: [],
  userInteractive: true,
  sessionId: 1,
};

test('unresponsive protocol calls have a bounded failure', async () => {
  await assert.rejects(
    bounded(new Promise(() => undefined), 'renderer probe', 10),
    /Timed out: renderer probe/,
  );
  assert.equal(await bounded(Promise.resolve('ready'), 'ready probe', 10), 'ready');
});

test('CLI parses paths with spaces and rejects ambiguous, missing or unsupported arguments', () => {
  assert.equal(parseArgs(ARGV).phase, 'create');
  assert.equal(parseArgs([...ARGV, '--expected-version', '0.0.0-dispatch.123']).phase, 'create');
  assert.throws(() => parseArgs([...ARGV, '--phase', 'reopen']), /Duplicate/);
  assert.throws(() => parseArgs(ARGV.slice(0, -1)), /Invalid argument/);
  assert.throws(() => parseArgs([...ARGV, '--smoke', 'true']), /Invalid argument/);
  assert.throws(
    () => parseArgs(ARGV.map((value) => (value === 'create' ? 'fake' : value))),
    /Phase/,
  );
  assert.throws(
    () => parseArgs(ARGV.map((value) => (value.endsWith('.exe') ? 'KerfDesk.exe' : value))),
    /absolute local/,
  );
  assert.throws(
    () =>
      parseArgs(ARGV.map((value) => (value.endsWith('.exe') ? '\\\\server\\KerfDesk.exe' : value))),
    /absolute local/,
  );
});

test('normal app launch guard rejects local, self-hosted, other OS and missing run identity', () => {
  assert.doesNotThrow(() => assertHostedWindows('win32', ENV));
  assert.throws(() => assertHostedWindows('linux', ENV), /GitHub-hosted Windows/);
  assert.throws(
    () => assertHostedWindows('win32', { ...ENV, GITHUB_ACTIONS: 'false' }),
    /GitHub-hosted Windows/,
  );
  assert.throws(
    () => assertHostedWindows('win32', { ...ENV, RUNNER_ENVIRONMENT: 'self-hosted' }),
    /GitHub-hosted Windows/,
  );
  assert.throws(() => assertHostedWindows('win32', { ...ENV, GITHUB_RUN_ID: '' }), /run identity/);
});

test('evidence is allowed only inside runner temp or the specific uploaded artifact subtree', () => {
  const parents = evidenceParents(ENV);
  assert.doesNotThrow(() => assertEvidencePath('C:\\runner\\temp\\attempt', parents));
  assert.doesNotThrow(() =>
    assertEvidencePath('D:\\a\\repo\\repo\\artifacts\\installed-qualification\\create', parents),
  );
  for (const path of [
    'C:\\runner\\temporary\\attempt',
    'C:\\Users\\person\\Desktop\\evidence',
    'D:\\a\\repo\\repo\\artifacts\\other',
    'D:\\a\\repo\\repo\\artifacts\\installed-qualification-other\\create',
    'D:\\a\\repo\\repo\\artifacts\\installed-qualification\\..\\other',
  ])
    assert.throws(() => assertEvidencePath(path, parents), /Evidence must/);
});

test('preflight rejects wrong profile, app outside temp, existing app and noninteractive runner', () => {
  const args = parseArgs(ARGV);
  assert.doesNotThrow(() => assertPreflight(args, PROBE, ENV));
  assert.throws(
    () => assertPreflight({ ...args, 'expected-profile': 'C:\\other' }, PROBE, ENV),
    /normal installed app profile/,
  );
  assert.throws(
    () => assertPreflight({ ...args, executable: 'C:\\Program Files\\KerfDesk.exe' }, PROBE, ENV),
    /owned parent/,
  );
  assert.throws(
    () => assertPreflight(args, { ...PROBE, existingProcesses: [{ id: 12 }] }, ENV),
    /already exists/,
  );
  assert.throws(() => assertPreflight(args, { ...PROBE, sessionId: 0 }, ENV), /interactive/);
  assert.throws(
    () => assertPreflight(args, { ...PROBE, userInteractive: false }, ENV),
    /interactive/,
  );
});

test('build badge assertions fail for stale version, wrong commit and missing identity', () => {
  const title = 'Built 2026-09-19\nCommit abc1234\nVersion 0.0.0-dispatch.123';
  const args = {
    'expected-version': '0.0.0-dispatch.123',
    'expected-commit': 'abc12345678901234567890123456789012345678',
  };
  assert.equal(assertBuildMetadata(title, args).commit, 'abc1234');
  assert.throws(
    () => assertBuildMetadata(title, { ...args, 'expected-version': '0.0.0-dispatch.124' }),
    /version/,
  );
  assert.throws(
    () => assertBuildMetadata(title, { ...args, 'expected-commit': 'fed1234' }),
    /commit/,
  );
  assert.throws(() => assertBuildMetadata('Version anything', {}), /metadata/);
});

function projectFixture() {
  return {
    schemaVersion: 7,
    workspace: { width: 300, height: 300, units: 'mm' },
    jobSetup: { placement: 'fixture' },
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'one',
          source: FIXTURE_NAME,
          paths: [
            {
              polylines: [
                {
                  points: [
                    { x: 2, y: 3 },
                    { x: 22, y: 3 },
                    { x: 22, y: 15 },
                    { x: 2, y: 15 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [{ id: 'operation-one', speed: 1000 }],
    },
  };
}

test('disk evidence rejects missing source, missing geometry and changed millimetre dimensions', () => {
  const project = projectFixture();
  assert.deepEqual(validateProject(Buffer.from(JSON.stringify(project))), project);
  const missing = structuredClone(project);
  missing.scene.objects[0].source = 'unrelated.svg';
  assert.throws(() => validateProject(Buffer.from(JSON.stringify(missing))), /source filename/);
  const changed = structuredClone(project);
  changed.scene.objects[0].paths[0].polylines[0].points[1].x = 200;
  assert.throws(() => validateProject(Buffer.from(JSON.stringify(changed))), /millimetre geometry/);
  assert.throws(
    () => validateProject(Buffer.from('{"schemaVersion":7,"scene":{"objects":[]}}')),
    /exactly one/,
  );
});

test('roundtrip comparison detects lost operations, changed geometry and changed workspace', () => {
  const project = projectFixture();
  assert.doesNotThrow(() => assertRoundtrip(project, structuredClone(project)));
  const changed = structuredClone(project);
  changed.scene.layers[0].speed = 10;
  assert.throws(() => assertRoundtrip(project, changed), /artwork\/operations changed/);
  const workspace = structuredClone(project);
  workspace.workspace.width = 500;
  assert.throws(() => assertRoundtrip(project, workspace), /workspace changed/);
});

test(
  'create claims only an empty profile and reopen retains the same workflow/project ownership',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'kerfdesk-profile-guard-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const args = {
      'expected-profile': join(root, 'profile'),
      project: join(root, 'project.lf2'),
      phase: 'create',
    };
    await prepareProfile(args, ENV);
    await assert.rejects(prepareProfile(args, ENV), /fresh empty/);
    await prepareProfile({ ...args, phase: 'reopen' }, ENV);
    await assert.rejects(
      prepareProfile({ ...args, phase: 'reopen' }, { ...ENV, GITHUB_RUN_ID: '456' }),
      /not owned/,
    );
    await assert.rejects(
      prepareProfile({ ...args, phase: 'reopen', project: join(root, 'other.lf2') }, ENV),
      /not owned/,
    );
  },
);

test('actual CLI refuses local launch before creating evidence or inspecting executable', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'installed-app-file-io.mjs');
  const result = spawnSync(process.execPath, [script, ...ARGV], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'local' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only on a disposable GitHub-hosted Windows runner/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn|executable.*not found/);
});

test(
  'native helper parses and independently refuses a local desktop',
  { skip: process.platform !== 'win32' },
  () => {
    const script = join(dirname(fileURLToPath(import.meta.url)), 'installed-file-dialog.ps1');
    const parse = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$tokens = $null; $parseErrors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:QUALIFICATION_SCRIPT_PATH, [ref]$tokens, [ref]$parseErrors) | Out-Null; if ($parseErrors.Count) { $parseErrors | Out-String | Write-Error; exit 1 }',
      ],
      {
        env: { ...process.env, QUALIFICATION_SCRIPT_PATH: script },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(parse.status, 0, parse.stderr);
    const guarded = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Action',
        'Preflight',
        '-ExpectedExecutable',
        'C:\\does-not-exist.exe',
        '-EvidenceRoot',
        'C:\\do-not-create',
      ],
      {
        env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'local' },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(guarded.status, 1);
    assert.match(guarded.stderr, /restricted to disposable GitHub-hosted Windows runners/);
  },
);
