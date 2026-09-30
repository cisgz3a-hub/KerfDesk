import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSmokeLaunchOptions, runIsolatedNativeSmoke } from './native-smoke-runner.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

export function validateNativeSmokeResult(result, expectedUserData, options = {}) {
  const expected = normalizedPath(expectedUserData);
  const renderer = object(result?.renderer);
  const failures = Array.isArray(result?.failures) ? result.failures : ['invalid failures field'];
  const problems = [
    ...(result?.ok === true ? [] : ['result was not ok']),
    ...(result?.isPackaged === true ? [] : ['app was not packaged']),
    ...(result?.isolated === true ? [] : ['profile was not isolated']),
    ...(normalizedPath(result?.userData) === expected ? [] : ['userData path mismatch']),
    ...(normalizedPath(result?.sessionData) === expected ? [] : ['sessionData path mismatch']),
    ...(result?.windowVisible === true ? [] : ['window did not become visible']),
    ...(failures.length === 0 ? [] : [`runtime failures: ${failures.join(' / ')}`]),
    ...(renderer?.readyToShow === true ? [] : ['ready-to-show was not reached']),
    ...(renderer?.imported === true ? [] : ['SVG import was not observed']),
    ...(renderer?.saved === true && Number(renderer?.savedBytes) > 0
      ? []
      : ['project save was not observed']),
    ...(renderer?.url === 'app://app/index.html' ? [] : ['unexpected renderer URL']),
    ...nativeSmokeSecurityProblems(result),
    ...nativeSmokeLicensingProblems(renderer?.licensing, options.expectFreshSandbox === true),
    ...(renderer?.fileAccess?.openPicker === 'stubbed' &&
    renderer?.fileAccess?.savePicker === 'stubbed' &&
    renderer?.fileAccess?.writeTarget === 'memory'
      ? []
      : ['file access evidence must identify stubbed pickers and an in-memory save']),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
  return result;
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
  const args = parseArgs(process.argv.slice(2));
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

function parseArgs(args) {
  const executable = args.find((arg) => !arg.startsWith('--'));
  if (executable === undefined || !isAbsolute(executable)) {
    throw new Error(
      'usage: verify-windows-packaged-native-smoke.mjs <absolute packaged executable> [--expect-fresh-sandbox]',
    );
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
