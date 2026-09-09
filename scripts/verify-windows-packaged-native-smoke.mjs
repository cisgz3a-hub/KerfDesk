import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSmokeLaunchOptions, runIsolatedNativeSmoke } from './native-smoke-runner.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

export function validateNativeSmokeResult(result, expectedUserData) {
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
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
  return result;
}

async function runCli() {
  if (process.platform !== 'win32') throw new Error('Windows packaged smoke requires Windows');
  const args = parseArgs(process.argv.slice(2));
  await runNativeSmoke(args, spawn, {
    reportEvidence: (path) => process.stdout.write(`NATIVE_SMOKE_EVIDENCE=${path}\n`),
  });
  process.stdout.write('NATIVE_SMOKE_EXIT=0\nNATIVE_SMOKE_OK=true\n');
}

export { nativeSmokeLaunchOptions };

export async function runNativeSmoke(args, spawnProcess = spawn, dependencies = {}) {
  const result = await runIsolatedNativeSmoke(args, validateNativeSmokeResult, {
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
    throw new Error('usage: verify-windows-packaged-native-smoke.mjs <absolute KerfDesk.exe>');
  }
  const output = valueFor(args, '--output=');
  const timeout = valueFor(args, '--timeout-ms=');
  const timeoutMs = timeout === null ? DEFAULT_TIMEOUT_MS : Number(timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be positive');
  return { executable, output, timeoutMs };
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
