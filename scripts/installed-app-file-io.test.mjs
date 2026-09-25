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
  summarizeDialogResults,
  validateProject,
} from './installed-app-evidence.mjs';
import { bounded, findDebugger, launchInstalledApp } from './installed-app-process.mjs';

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

test('native dialog failure evidence retains both the helper and triggering click outcomes', () => {
  const result = summarizeDialogResults('import', 'Import...', [
    { status: 'rejected', reason: new Error('No native dialog') },
    { status: 'rejected', reason: new Error('Click intercepted by an overlay') },
  ]);
  assert.match(result.failure, /native-helper: Error: No native dialog/);
  assert.match(result.failure, /renderer-click: Error: Click intercepted by an overlay/);
  const passed = summarizeDialogResults('save', 'Save As...', [
    { status: 'fulfilled', value: { ok: true } },
    { status: 'fulfilled', value: undefined },
  ]);
  assert.equal(passed.failure, null);
  assert.deepEqual(
    passed.outcomes.map((result) => result.status),
    ['fulfilled', 'fulfilled'],
  );
});

test('installed GUI launch stays visible and strips Node-only environment flags without launching', async () => {
  const calls = [];
  const observed = {};
  const args = parseArgs(ARGV);
  const original = {
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
    KERFDESK_QUALIFICATION_LAUNCH_TEST: process.env.KERFDESK_QUALIFICATION_LAUNCH_TEST,
  };
  try {
    process.env.NODE_OPTIONS = '--inspect=12345';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.KERFDESK_QUALIFICATION_LAUNCH_TEST = 'preserved';
    const result = await launchInstalledApp(args, (...input) => {
      calls.push(input);
      return observed;
    });
    assert.equal(result, observed);
    assert.equal(calls.length, 1);
    const [executable, flags, options] = calls[0];
    assert.equal(executable, args.executable);
    assert.deepEqual(flags, ['--remote-debugging-port=0']);
    assert.deepEqual(result.launchArgs, flags);
    assert.equal(options.cwd, dirname(args.executable));
    assert.equal(options.windowsHide, false);
    assert.notEqual(options.env, process.env);
    assert.equal(options.env.KERFDESK_QUALIFICATION_LAUNCH_TEST, 'preserved');
    assert.equal(Object.hasOwn(options.env, 'NODE_OPTIONS'), false);
    assert.equal(Object.hasOwn(options.env, 'ELECTRON_RUN_AS_NODE'), false);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
});

test('unresponsive protocol calls have a bounded failure', async () => {
  await assert.rejects(
    bounded(new Promise(() => undefined), 'renderer probe', 10),
    /Timed out: renderer probe/,
  );
  assert.equal(await bounded(Promise.resolve('ready'), 'ready probe', 10), 'ready');
});

test('debugger discovery retries a transient Windows file lock but requires the exact owned endpoint', async () => {
  const endpoint = 'ws://127.0.0.1:9234/devtools/browser/owned-fixture';
  const app = { error: null, exit: null, stderr: `DevTools listening on ${endpoint}` };
  const profile = join(tmpdir(), 'owned-qualification-profile');
  let reads = 0;
  const discovered = await findDebugger(app, profile, async (path, encoding) => {
    assert.equal(path, join(profile, 'DevToolsActivePort'));
    assert.equal(encoding, 'utf8');
    reads++;
    if (reads === 1) throw Object.assign(new Error('Writer still owns file'), { code: 'EBUSY' });
    if (reads === 2) return '9234\n';
    if (reads === 3) return '9234\n/devtools/browser/unrelated-target';
    return '9234\n/devtools/browser/owned-fixture';
  });
  assert.equal(reads, 4);
  assert.equal(discovered.endpoint, endpoint);
  assert.deepEqual(discovered.activePort, {
    port: 9234,
    pathname: '/devtools/browser/owned-fixture',
  });
  const denied = Object.assign(new Error('Permanent access failure'), { code: 'EACCES' });
  await assert.rejects(
    findDebugger(app, profile, async () => {
      throw denied;
    }),
    (error) => error === denied,
  );
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
    schemaVersion: 9,
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
    () => validateProject(Buffer.from('{"schemaVersion":9,"scene":{"objects":[]}}')),
    /exactly one/,
  );
});

test('disk evidence rejects a stale schema-8 save from an older installed build', () => {
  const stale = { ...projectFixture(), schemaVersion: 8 };
  assert.throws(
    () => validateProject(Buffer.from(JSON.stringify(stale))),
    /Expected current project schema/,
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
        // Fresh hosted Windows images can spend over ten seconds starting PowerShell.
        timeout: 30_000,
      },
    );
    assert.ifError(parse.error);
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
        timeout: 30_000,
      },
    );
    assert.ifError(guarded.error);
    assert.equal(guarded.status, 1);
    assert.match(guarded.stderr, /restricted to disposable GitHub-hosted Windows runners/);
  },
);
