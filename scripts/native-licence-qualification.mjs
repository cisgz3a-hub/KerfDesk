// Public-safe observations for the shipped developer-only native qualifier.
import { isAbsolute, join } from 'node:path';
import { validateNativeSmokeResult } from './verify-windows-packaged-native-smoke.mjs';

export const LICENCE_SECRET = 'KERFDESK_NATIVE_QUALIFICATION_LICENCE';
export const ISSUED_GRANT = 'johann';
const KEY = /^KD1\.[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{43}$/u;

export class LicenceQualificationError extends Error {
  constructor(code, processClosed = true) {
    super(code);
    this.code = code;
    this.processClosed = processClosed;
  }
}

const WINDOWS_ENVIRONMENT = new Set([
  'allusersprofile',
  'appdata',
  'commonprogramfiles',
  'commonprogramfiles(x86)',
  'computername',
  'comspec',
  'home',
  'homedrive',
  'homepath',
  'localappdata',
  'number_of_processors',
  'os',
  'path',
  'pathext',
  'processor_architecture',
  'processor_identifier',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'sessionname',
  'systemdrive',
  'systemroot',
  'temp',
  'tmp',
  'userdomain',
  'username',
  'userprofile',
  'windir',
  'electron_builder_cache',
  'github_actions',
  'github_workspace',
  'github_run_id',
  'github_run_attempt',
  'runner_environment',
  'runner_temp',
]);

/** Native children need Windows/owned-runner settings, never provider or OAuth secrets. */
export function nativeQualificationEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => WINDOWS_ENVIRONMENT.has(name.toLowerCase()) && typeof value === 'string',
    ),
  );
}

export function privateQualificationDocument(environment) {
  const key = environment[LICENCE_SECRET];
  delete environment.KERFDESK_NATIVE_QUALIFICATION_LICENCE;
  if (typeof key !== 'string' || !KEY.test(key))
    throw new LicenceQualificationError('missing-or-invalid-private-licence');
  return JSON.stringify({ schemaVersion: 1, grants: [{ grantId: ISSUED_GRANT, licenseKey: key }] });
}

export function nativeLicenceArguments({ profile, result, phase, keyFile }) {
  if (
    ![profile, result].every(isAbsolute) ||
    !['activate', 'offline', 'deactivate'].includes(phase)
  )
    throw new LicenceQualificationError('invalid-native-qualification-path-or-phase');
  const args = [
    '--force-renderer-accessibility',
    `--kerfdesk-native-smoke-user-data=${profile}`,
    `--kerfdesk-native-smoke-result=${result}`,
    `--kerfdesk-native-smoke-licence-phase=${phase}`,
  ];
  if (phase === 'activate') {
    if (!isAbsolute(keyFile ?? '')) throw new LicenceQualificationError('invalid-private-key-path');
    args.push(
      `--kerfdesk-native-smoke-key-file=${keyFile}`,
      `--kerfdesk-native-smoke-grant-id=${ISSUED_GRANT}`,
    );
  }
  return args;
}

function licenceState(value) {
  return {
    channel: value?.channel === 'commercial' ? 'commercial' : null,
    state: ['ready', 'activation-required'].includes(value?.state) ? value.state : null,
    edition: ['pro', 'free'].includes(value?.edition) ? value.edition : null,
    tier: value?.tier === 'developer' ? 'developer' : null,
    perpetualUpdates: value?.perpetualUpdates === true,
    accessExpiresAt: value?.accessExpiresAt === null ? null : 'unexpected',
    updatesUntil: value?.updatesUntil === null ? null : 'unexpected',
    deactivationPending: value?.deactivationPending === true,
  };
}

const developer = (value) =>
  value?.channel === 'commercial' &&
  value.state === 'ready' &&
  value.edition === 'pro' &&
  value.tier === 'developer' &&
  value.perpetualUpdates === true &&
  value.accessExpiresAt === null &&
  value.updatesUntil === null &&
  value.deactivationPending === false;
const free = (value) =>
  value?.channel === 'commercial' &&
  value.state === 'activation-required' &&
  value.edition === 'free' &&
  value.tier === null &&
  value.deactivationPending === false;

export function publicNativePhase(result, processResult, profile, phase, label) {
  const observation = result?.renderer?.licenceQualification;
  const offline = result?.networkIsolation;
  let passed = false;
  try {
    validateNativeSmokeResult(result, profile);
    const stateMatches =
      phase === 'deactivate'
        ? free(observation?.after)
        : developer(observation?.after) && observation?.proAction === 'design-studio-opened';
    const beforeMatches =
      phase === 'activate'
        ? free(observation?.before)
        : phase === 'offline'
          ? developer(observation?.before)
          : true;
    const networkMatches =
      phase !== 'offline' ||
      (offline?.mode === 'offline-enforced' &&
        offline.chromiumProbeBlocked === true &&
        offline.nodeProbeBlocked === true);
    passed =
      stateMatches &&
      beforeMatches &&
      networkMatches &&
      observation?.phase === phase &&
      processResult.code === 0 &&
      processResult.spawned === true &&
      processResult.exited === true &&
      processResult.childClosed === true &&
      processResult.failure === null &&
      result?.supportLog?.recordedLaunch === true;
  } catch {
    // Do not copy an exception, console message or process output into public evidence.
  }
  return {
    label,
    phase,
    passed,
    process: {
      spawned: processResult.spawned === true,
      exitCode: Number.isInteger(processResult.code) ? processResult.code : null,
      closed: processResult.childClosed === true,
      failure: processResult.failure === null ? null : 'native-process-failed',
    },
    packaged: result?.isPackaged === true,
    profileIsolated: result?.isolated === true,
    visible: result?.windowVisible === true,
    secureRenderer:
      result?.webPreferences?.sandbox === true &&
      result?.webPreferences?.contextIsolation === true &&
      result?.webPreferences?.nodeIntegration === false &&
      result?.webPreferences?.webSecurity === true,
    devToolsRejected: result?.devToolsProbe?.opened === false,
    supportLogRecordedLaunch: result?.supportLog?.recordedLaunch === true,
    before: licenceState(observation?.before),
    after: licenceState(observation?.after),
    proToolOpened: observation?.proAction === 'design-studio-opened',
    nativeDeactivationObserved:
      phase === 'deactivate' &&
      free(observation?.after) &&
      (developer(observation?.before) || observation?.before?.deactivationPending === true),
    offlineEnforced:
      offline?.mode === 'offline-enforced' &&
      offline.chromiumProbeBlocked === true &&
      offline.nodeProbeBlocked === true,
    filePickers: 'stubbed',
    projectSaveTarget: 'memory',
  };
}

/** Always try ordinary online deactivation after an activation attempt, even on failure. */
export async function retainedDeveloperSequence(actions) {
  const receipt = {
    passed: false,
    stages: [],
    failure: null,
    cleanup: { attempted: false, passed: false },
  };
  let processClosed = true;
  let bodyPassed = false;
  const phase = async (name, label = name) => {
    const observed = await actions.phase(name, label);
    receipt.stages.push(observed);
    processClosed = observed.process.closed;
    if (!observed.passed) throw new LicenceQualificationError('native-phase-failed', processClosed);
    return observed;
  };
  try {
    await phase('activate');
    if (!(await actions.credentialPresent()))
      throw new LicenceQualificationError('credential-file-missing');
    await phase('offline', 'offline-after-restart');
    await actions.reinstall();
    receipt.reinstalledSamePublishedBytes = true;
    if (!(await actions.credentialPresent()))
      throw new LicenceQualificationError('credential-not-retained');
    await phase('offline', 'offline-after-reinstall');
    bodyPassed = true;
  } catch (error) {
    if (error instanceof LicenceQualificationError) processClosed = error.processClosed;
    receipt.failure = 'qualification-incomplete';
  } finally {
    if (processClosed) {
      receipt.cleanup.attempted = true;
      try {
        const observed = await phase('deactivate', 'online-deactivation');
        receipt.cleanup.passed = true;
        receipt.cleanup.nativeDeactivationObserved = observed.nativeDeactivationObserved === true;
        receipt.cleanup.serverSeatReleaseUnknown = true;
      } catch (error) {
        if (error instanceof LicenceQualificationError) processClosed = error.processClosed;
        receipt.cleanup.failure = processClosed
          ? 'deactivation-not-confirmed'
          : 'owned-app-process-did-not-close';
      }
    } else receipt.cleanup.failure = 'owned-app-process-did-not-close';
  }
  receipt.passed =
    bodyPassed && receipt.cleanup.passed && receipt.cleanup.nativeDeactivationObserved === true;
  return receipt;
}

export const privateNativeResult = (root, label) => join(root, `${label}.json`);
