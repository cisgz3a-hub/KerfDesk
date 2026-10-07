import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  LICENCE_SECRET,
  LicenceQualificationError,
  nativeQualificationEnvironment,
  privateQualificationDocument,
  nativeLicenceArguments,
  publicNativePhase,
  retainedDeveloperSequence,
} from './native-licence-qualification.mjs';
import { nativePhase, qualificationInput } from './qualify-desktop-licence.mjs';

const key = `KD1.synthetic-qualification.${'x'.repeat(43)}`;
const profile = resolve('owned-test-profile');
const processResult = { code: 0, spawned: true, exited: true, childClosed: true, failure: null };
const state = (tier) => ({
  channel: 'commercial',
  state: tier ? 'ready' : 'activation-required',
  edition: tier ? 'pro' : 'free',
  tier,
  perpetualUpdates: Boolean(tier),
  accessExpiresAt: null,
  updatesUntil: null,
  deactivationPending: false,
});
function nativeResult(phase, tier = 'developer') {
  return {
    ok: true,
    isPackaged: true,
    isolated: true,
    userData: profile,
    sessionData: profile,
    windowVisible: true,
    failures: [],
    webPreferences: {
      available: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: 'not-reported',
    },
    devToolsProbe: { method: 'openDevTools', opened: false },
    supportLog: { recordedLaunch: true },
    networkIsolation: {
      mode: 'offline-enforced',
      chromiumProbeBlocked: true,
      nodeProbeBlocked: true,
    },
    renderer: {
      readyToShow: true,
      imported: true,
      saved: true,
      savedBytes: 50,
      url: 'app://app/index.html',
      nodePrimitives: {
        require: 'undefined',
        process: 'undefined',
        module: 'undefined',
        Buffer: 'undefined',
      },
      fileAccess: { openPicker: 'stubbed', savePicker: 'stubbed', writeTarget: 'memory' },
      licensing: {
        kind: 'observed',
        channel: 'commercial',
        state: 'ready',
        edition: 'pro',
        proEnabled: true,
        updateState: 'unavailable',
      },
      licenceQualification: {
        phase,
        before: phase === 'activate' ? state(null) : state(tier),
        after: phase === 'deactivate' ? state(null) : state(tier),
        proAction: 'design-studio-opened',
      },
    },
  };
}

test('the private key is removed from inherited environment and used only by activation', () => {
  const environment = { [LICENCE_SECRET]: key };
  const document = JSON.parse(privateQualificationDocument(environment));
  assert.equal(environment[LICENCE_SECRET], undefined);
  assert.equal(document.grants[0].licenseKey, key);
  const args = nativeLicenceArguments({
    profile,
    result: resolve('result.json'),
    phase: 'activate',
    keyFile: resolve('private-key.json'),
  });
  assert.equal(
    args.some((value) => value.includes(key)),
    false,
  );
  const offline = nativeLicenceArguments({
    profile,
    result: resolve('result.json'),
    phase: 'offline',
  });
  assert.equal(
    offline.some((value) => /key-file|grant-id/u.test(value)),
    false,
  );
  assert.throws(
    () => privateQualificationDocument({ [LICENCE_SECRET]: 'bad' }),
    /invalid-private-licence/u,
  );
});

test('paid, trial, missing offline isolation, insecure renderer and an unclosed process cannot pass', () => {
  for (const tier of ['paid', 'trial']) {
    assert.equal(
      publicNativePhase(nativeResult('activate', tier), processResult, profile, 'activate', 'test')
        .passed,
      false,
    );
  }
  const offline = nativeResult('offline');
  offline.networkIsolation.nodeProbeBlocked = false;
  assert.equal(publicNativePhase(offline, processResult, profile, 'offline', 'test').passed, false);
  const insecure = nativeResult('activate');
  insecure.webPreferences.sandbox = false;
  assert.equal(
    publicNativePhase(insecure, processResult, profile, 'activate', 'test').passed,
    false,
  );
  assert.equal(
    publicNativePhase(
      nativeResult('activate'),
      { ...processResult, childClosed: false },
      profile,
      'activate',
      'test',
    ).passed,
    false,
  );
});

test('public evidence drops keys, credentials, identities, email, errors and raw output', () => {
  const result = nativeResult('activate');
  result.renderer.licenceQualification.after.licenseId = 'private-id';
  result.renderer.licenceQualification.after.email = 'private@example.invalid';
  result.renderer.activationToken = key;
  result.error = 'private-error';
  const safe = publicNativePhase(
    result,
    { ...processResult, stdout: key, stderr: 'private@example.invalid' },
    profile,
    'activate',
    'activate',
  );
  assert.equal(safe.passed, true);
  assert.doesNotMatch(
    JSON.stringify(safe),
    /private-id|private@|private-error|KD1|activationToken/u,
  );
});

test('retention sequence reuses native profile and cleans the seat after an offline failure', async () => {
  const calls = [];
  const receipt = await retainedDeveloperSequence({
    phase: async (phase, label) => {
      calls.push([phase, label]);
      return { passed: label !== 'offline-after-restart', process: { closed: true } };
    },
    credentialPresent: async () => true,
    reinstall: async () => calls.push(['reinstall']),
  });
  assert.deepEqual(
    calls.map((value) => value[0]),
    ['activate', 'offline', 'deactivate'],
  );
  assert.equal(receipt.passed, false);
  assert.equal(receipt.cleanup.passed, true);
});

test('successful sequence includes unchanged-package reinstall and confirmed deactivation', async () => {
  const calls = [];
  const receipt = await retainedDeveloperSequence({
    phase: async (phase) => {
      calls.push(phase);
      return {
        passed: true,
        nativeDeactivationObserved: phase === 'deactivate',
        process: { closed: true },
      };
    },
    credentialPresent: async () => true,
    reinstall: async () => calls.push('reinstall'),
  });
  assert.deepEqual(calls, ['activate', 'offline', 'reinstall', 'offline', 'deactivate']);
  assert.equal(receipt.passed, true);
  const unclosed = await retainedDeveloperSequence({
    phase: async () => ({ passed: false, process: { closed: false } }),
    credentialPresent: async () => true,
    reinstall: async () => assert.fail('cannot reinstall'),
  });
  assert.equal(unclosed.cleanup.attempted, false);
  assert.equal(unclosed.cleanup.failure, 'owned-app-process-did-not-close');
});

test('CLI refuses persistent machines, escaping paths and duplicate release identity', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_TEMP: resolve('runner-temp'),
    GITHUB_WORKSPACE: resolve('workspace'),
    SystemRoot: resolve('windows'),
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
  };
  const args = [
    '--version=1.0.11',
    `--source=${'a'.repeat(40)}`,
    `--output=${resolve('workspace/artifacts/installed-qualification/licence')}`,
  ];
  assert.equal(qualificationInput(args, env, 'win32').version, '1.0.11');
  assert.throws(() => qualificationInput(args, env, 'linux'), /disposable-hosted/u);
  assert.throws(
    () => qualificationInput([...args, '--version=1.0.10'], env, 'win32'),
    /invalid-arguments/u,
  );
  assert.throws(
    () => qualificationInput([args[0], args[1], `--output=${resolve('elsewhere')}`], env, 'win32'),
    /escaped-owned-root/u,
  );
});

test('workflow keeps historical default and uploads only explicit safe evidence', async () => {
  const yaml = await readFile(
    new URL('../.github/workflows/qualify-desktop-upgrade.yml', import.meta.url),
    'utf8',
  );
  assert.match(yaml, /qualification_mode:[\s\S]*?default: historical-upgrade/u);
  assert.match(
    yaml,
    /KERFDESK_NATIVE_QUALIFICATION_LICENCE: \$\{\{ secrets\.KERFDESK_NATIVE_QUALIFICATION_LICENCE \}\}/u,
  );
  assert.match(yaml, /cancel-in-progress: false/u);
  const licenceJob = yaml.slice(yaml.indexOf('  native-developer-licence:'));
  assert.doesNotMatch(licenceJob, /path:[\s\S]*?RUNNER_TEMP|path:[\s\S]*?private/u);
  assert.match(licenceJob, /screenshots\/\*\.png/u);
});

test('native child environment admits Windows paths and hosted guards but excludes every credential', () => {
  const safe = nativeQualificationEnvironment({
    Path: 'C:/Windows',
    SystemRoot: 'C:/Windows',
    GITHUB_ACTIONS: 'true',
    RUNNER_TEMP: 'C:/owned',
    [LICENCE_SECRET]: key,
    GITHUB_TOKEN: 'oauth',
    GH_TOKEN: 'oauth',
    CLOUDFLARE_API_TOKEN: 'api',
    DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: 'signing',
    secret_title: 'private',
    NODE_OPTIONS: '--inspect',
    PSModulePath: 'incompatible-pwsh-module-path',
  });
  assert.deepEqual(safe, {
    Path: 'C:/Windows',
    SystemRoot: 'C:/Windows',
    GITHUB_ACTIONS: 'true',
    RUNNER_TEMP: 'C:/owned',
  });
});

test('an already Free local profile never claims that a server seat was released', async () => {
  const result = nativeResult('deactivate');
  result.renderer.licenceQualification.before = state(null);
  const observed = publicNativePhase(result, processResult, profile, 'deactivate', 'cleanup');
  assert.equal(observed.passed, true);
  assert.equal(observed.nativeDeactivationObserved, false);
  const receipt = await retainedDeveloperSequence({
    phase: async () => ({
      passed: true,
      nativeDeactivationObserved: false,
      process: { closed: true },
    }),
    credentialPresent: async () => true,
    reinstall: async () => null,
  });
  assert.equal(receipt.passed, false);
  assert.equal(receipt.cleanup.serverSeatReleaseUnknown, true);
});

test('cleanup never launches another copy when phase throws with an unclosed owned process', async () => {
  let calls = 0;
  const receipt = await retainedDeveloperSequence({
    phase: async () => {
      calls += 1;
      throw new LicenceQualificationError('closed-unknown', false);
    },
    credentialPresent: async () => true,
    reinstall: async () => null,
  });
  assert.equal(calls, 1);
  assert.equal(receipt.cleanup.attempted, false);
});

for (const childClosed of [false, true])
  test(`native evidence-write failure preserves ${childClosed ? 'closed' : 'unclosed'} process state through cleanup`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-native-evidence-'));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    let phaseCalls = 0;
    let phaseError;
    try {
      const receipt = await retainedDeveloperSequence({
        phase: async (name, label) => {
          phaseCalls += 1;
          try {
            return await nativePhase(
              { output: join(directory, 'missing-evidence-directory') },
              {
                installRoot: join(directory, 'unused-install'),
                privateRoot: directory,
                profile: join(directory, 'unused-profile'),
                keyFile: join(directory, 'unused-key.json'),
              },
              name,
              label,
              () => assert.fail('cannot spawn a native process'),
              async () => ({ ...processResult, childClosed }),
            );
          } catch (error) {
            phaseError = error;
            throw error;
          }
        },
        credentialPresent: async () => assert.fail('cannot read a credential'),
        reinstall: async () => assert.fail('cannot run an installer'),
      });
      assert.equal(phaseCalls, childClosed ? 2 : 1);
      assert.ok(phaseError instanceof LicenceQualificationError);
      assert.equal(phaseError.code, 'native-phase-evidence-failed');
      assert.equal(phaseError.processClosed, childClosed);
      assert.equal(receipt.cleanup.attempted, childClosed);
      assert.equal(
        receipt.cleanup.failure,
        childClosed ? 'deactivation-not-confirmed' : 'owned-app-process-did-not-close',
      );
      assert.equal(receipt.passed, false);
    } finally {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true });
    }
  });

for (const childClosed of [false, true])
  test(`deactivation evidence-write failure preserves ${childClosed ? 'closed' : 'unclosed'} process state after successful earlier phases`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-native-deactivation-'));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    const paths = {
      installRoot: join(directory, 'unused-install'),
      privateRoot: join(directory, 'private'),
      profile: join(directory, 'unused-profile'),
      keyFile: join(directory, 'unused-key.json'),
    };
    const evidence = join(directory, 'evidence');
    const calls = [];
    let phaseError;
    try {
      await mkdir(paths.privateRoot);
      await mkdir(evidence);
      const receipt = await retainedDeveloperSequence({
        phase: async (name, label) => {
          calls.push(name);
          const result = {
            ...nativeResult(name),
            userData: paths.profile,
            sessionData: paths.profile,
          };
          await writeFile(join(paths.privateRoot, `${label}.json`), JSON.stringify(result));
          try {
            return await nativePhase(
              {
                output:
                  name === 'deactivate' ? join(directory, 'missing-evidence-directory') : evidence,
              },
              paths,
              name,
              label,
              () => assert.fail('cannot spawn a native process'),
              async () => ({
                ...processResult,
                childClosed: name === 'deactivate' ? childClosed : true,
              }),
            );
          } catch (error) {
            phaseError = error;
            throw error;
          }
        },
        credentialPresent: async () => true,
        reinstall: async () => calls.push('reinstall'),
      });
      assert.deepEqual(calls, ['activate', 'offline', 'reinstall', 'offline', 'deactivate']);
      assert.equal(receipt.stages.length, 3);
      assert.ok(receipt.stages.every(({ passed }) => passed));
      assert.equal(receipt.reinstalledSamePublishedBytes, true);
      assert.ok(phaseError instanceof LicenceQualificationError);
      assert.equal(phaseError.code, 'native-phase-evidence-failed');
      assert.equal(phaseError.processClosed, childClosed);
      assert.equal(receipt.cleanup.attempted, true);
      assert.equal(receipt.cleanup.passed, false);
      assert.equal(
        receipt.cleanup.failure,
        childClosed ? 'deactivation-not-confirmed' : 'owned-app-process-did-not-close',
      );
      assert.equal(receipt.passed, false);
    } finally {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true });
    }
  });
