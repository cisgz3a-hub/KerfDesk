import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSmokeLaunchOptions, runIsolatedNativeSmoke } from './native-smoke-runner.mjs';
import { DESKTOP_LICENCE_WINDOW } from '../public/desktop-licence-window.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

export function validateNativeSmokeResult(result, expectedUserData, options = {}) {
  const expected = normalizedPath(expectedUserData);
  const renderer = object(result?.renderer);
  const failures = Array.isArray(result?.failures) ? result.failures : ['invalid failures field'];
  const freshSandbox = options.expectFreshSandbox === true;
  // `expectLicenceWindow` names an unlicensed commercial package. It opens behind
  // its licence window only while that window is on; while ADR-623 Amendment 3
  // holds it off, the package must open its KerfDesk Free workspace instead.
  const licenceWindow = options.licenceWindow ?? DESKTOP_LICENCE_WINDOW;
  const unlicensedCommercial = options.expectLicenceWindow === true;
  const expectLicenceWindow = unlicensedCommercial && licenceWindow;
  const freshSandboxWindow = freshSandbox && licenceWindow;
  // Fresh commercial packages and a qualification profile still signing out
  // open behind a licence window, with no workspace to import into or save from
  // (ADR-623). The commercial-package expectation also rejects workspace evidence.
  const behindLicence =
    (freshSandboxWindow || expectLicenceWindow || options.acceptLicenceWindow === true) &&
    renderer?.licenceWindow === true;
  const problems = [
    ...(result?.ok === true ? [] : ['result was not ok']),
    ...(result?.isPackaged === true ? [] : ['app was not packaged']),
    ...(result?.isolated === true ? [] : ['profile was not isolated']),
    ...(normalizedPath(result?.userData) === expected ? [] : ['userData path mismatch']),
    ...(normalizedPath(result?.sessionData) === expected ? [] : ['sessionData path mismatch']),
    ...(result?.windowVisible === true ? [] : ['window did not become visible']),
    ...(failures.length === 0 ? [] : [`runtime failures: ${failures.join(' / ')}`]),
    ...(renderer?.readyToShow === true ? [] : ['ready-to-show was not reached']),
    ...(behindLicence ? noWorkspaceProblems(renderer) : workspaceProblems(renderer)),
    ...(expectLicenceWindow ? licenceWindowProblems(renderer) : []),
    ...(unlicensedCommercial && !licenceWindow ? unlicensedFreeProblems(renderer) : []),
    ...(freshSandboxWindow && !behindLicence
      ? ['fresh sandbox must open behind the licence window, not the workspace']
      : []),
    ...(renderer?.url === 'app://app/index.html' ? [] : ['unexpected renderer URL']),
    ...nativeSmokeSecurityProblems(result),
    ...nativeSmokeLicensingProblems(renderer?.licensing, freshSandbox),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
  return result;
}

/** Behind the licence window no workspace exists, so nothing may claim I/O there. */
function noWorkspaceProblems(renderer) {
  return renderer.imported === false &&
    renderer.saved === false &&
    renderer.savedBytes === undefined &&
    renderer.fileAccess === undefined
    ? []
    : ['the licence window reported workspace import, save or file access'];
}

/**
 * A fresh commercial package must be one a trial or key can open. Linux keeps
 * licences only in a Secret Service keyring (licensing-store.ts), so
 * build-commercial-platform.sh launches it with an unlocked GNOME Keyring.
 */
function licenceWindowProblems(renderer) {
  const licensing = renderer?.licensing;
  return renderer?.licenceWindow === true &&
    renderer.imported === false &&
    renderer.saved === false &&
    renderer.savedBytes === undefined &&
    renderer.fileAccess === undefined &&
    licensing?.channel === 'commercial' &&
    licensing.edition === 'free' &&
    licensing.proEnabled === false &&
    licensing.state === 'activation-required'
    ? []
    : ['commercial licence window must report unlicensed commercial status and no workspace I/O'];
}

/**
 * While the licence window is held off (ADR-623 Amendment 3), an unlicensed
 * commercial package opens straight into KerfDesk Free, as 1.0.20 did, and a
 * trial or key can still unlock Pro there. Its import and save are checked as
 * for any workspace.
 */
function unlicensedFreeProblems(renderer) {
  const licensing = renderer?.licensing;
  return renderer?.licenceWindow !== true &&
    licensing?.channel === 'commercial' &&
    licensing.edition === 'free' &&
    licensing.proEnabled === false &&
    licensing.state === 'activation-required'
    ? []
    : [
        'unlicensed commercial package must open its Free workspace with unlicensed commercial status',
      ];
}

function workspaceProblems(renderer) {
  return [
    ...(renderer?.imported === true ? [] : ['SVG import was not observed']),
    ...(renderer?.saved === true && Number(renderer?.savedBytes) > 0
      ? []
      : ['project save was not observed']),
    ...(renderer?.fileAccess?.openPicker === 'stubbed' &&
    renderer?.fileAccess?.savePicker === 'stubbed' &&
    renderer?.fileAccess?.writeTarget === 'memory'
      ? []
      : ['file access evidence must identify stubbed pickers and an in-memory save']),
  ];
}

function nativeSmokeLicensingProblems(observed, expectFreshSandbox) {
  const states = [
    'ready',
    'activation-required',
    'trial-expired',
    'updates-expired',
    'invalid-licence',
    'unavailable',
    'clock-error',
  ];
  const updateStates = [
    'unavailable',
    'idle',
    'checking',
    'available',
    'downloading',
    'up-to-date',
    'ready',
    'not-covered',
    'failed',
  ];
  if (
    observed?.kind !== 'observed' ||
    !['free', 'commercial'].includes(observed.channel) ||
    !states.includes(observed.state) ||
    !['free', 'pro'].includes(observed.edition) ||
    observed.proEnabled !== (observed.edition === 'pro') ||
    !updateStates.includes(observed.updateState)
  )
    return ['local licensing status was missing or invalid'];
  if (
    expectFreshSandbox &&
    (observed.channel !== 'commercial' ||
      observed.state !== 'activation-required' ||
      observed.edition !== 'free' ||
      observed.proEnabled !== false ||
      observed.updateState !== 'unavailable')
  )
    return [
      'fresh sandbox must report commercial licensing, activation-required, Free and unavailable updates',
    ];
  return [];
}

function nativeSmokeSecurityProblems(result) {
  const preferences = object(result?.webPreferences);
  const primitives = object(result?.renderer?.nodePrimitives);
  const problems = [];
  if (preferences?.available !== true) problems.push('runtime webPreferences were unavailable');
  for (const [name, expected] of Object.entries({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
  })) {
    if (preferences?.[name] !== expected) problems.push(`runtime ${name} was not ${expected}`);
  }
  if (result?.devToolsProbe?.method !== 'openDevTools' || result?.devToolsProbe?.opened !== false) {
    problems.push('runtime DevTools did not reject the open attempt');
  }
  if (preferences?.preload !== 'not-reported') {
    problems.push('runtime preload evidence was unexpected or missing');
  }
  for (const name of ['require', 'process', 'module', 'Buffer']) {
    if (primitives?.[name] !== 'undefined') {
      problems.push(`renderer Node primitive ${name} was exposed or not inspected`);
    }
  }
  return problems;
}

async function runCli() {
  // Every pull request runs this smoke against the packaged app on Windows,
  // macOS and Linux (ADR-483, ADR-522).
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new Error('Packaged smoke runs on Windows, macOS or Linux');
  }
  const args = parseNativeSmokeArgs(process.argv.slice(2));
  await runNativeSmoke(args, spawn, {
    reportEvidence: (path) => process.stdout.write(`NATIVE_SMOKE_EVIDENCE=${path}\n`),
  });
  process.stdout.write('NATIVE_SMOKE_EXIT=0\nNATIVE_SMOKE_OK=true\n');
}

export { nativeSmokeLaunchOptions };

export async function runNativeSmoke(args, spawnProcess = spawn, dependencies = {}) {
  const validate = (result, userData) => validateNativeSmokeResult(result, userData, args);
  const result = await runIsolatedNativeSmoke(args, validate, {
    ...dependencies,
    spawnProcess,
  });
  if (result.manifest.outcome !== 'success') {
    throw Object.assign(
      new Error(`${result.manifest.failure.message}; evidence=${result.evidenceDirectory}`),
      result,
    );
  }
  return result;
}

export function parseNativeSmokeArgs(args) {
  const executable = args.find((arg) => !arg.startsWith('--'));
  if (executable === undefined || !isAbsolute(executable)) {
    throw new Error(
      'usage: verify-windows-packaged-native-smoke.mjs <absolute packaged executable> [--expect-fresh-sandbox | --expect-licence-window]',
    );
  }
  if (args.includes('--expect-fresh-sandbox') && args.includes('--expect-licence-window')) {
    throw new Error('choose one licensing expectation');
  }
  const output = valueFor(args, '--output=');
  const timeout = valueFor(args, '--timeout-ms=');
  const timeoutMs = timeout === null ? DEFAULT_TIMEOUT_MS : Number(timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be positive');
  return {
    executable,
    output,
    timeoutMs,
    expectFreshSandbox: args.includes('--expect-fresh-sandbox'),
    expectLicenceWindow: args.includes('--expect-licence-window'),
    // What an unlicensed commercial package opens into (ADR-623 Amendment 3).
    licenceWindow: DESKTOP_LICENCE_WINDOW,
  };
}

function valueFor(args, prefix) {
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  return arg === undefined ? null : arg.slice(prefix.length);
}

function object(value) {
  return value !== null && typeof value === 'object' ? value : null;
}

function normalizedPath(value) {
  return typeof value === 'string' ? resolve(value).toLowerCase() : '';
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await runCli().catch((error) => {
    process.stderr.write(`packaged native smoke failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
