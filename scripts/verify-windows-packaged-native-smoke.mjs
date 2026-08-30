import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const executable = resolve(args.executable);
  const root = await mkdtemp(resolve(tmpdir(), 'kerfdesk-native-smoke-'));
  const userData = resolve(root, 'user-data');
  const resultPath = resolve(root, 'native-smoke-result.json');
  const output = resolve(args.output ?? 'artifacts/native-smoke');
  await mkdir(userData, { recursive: true });
  try {
    const processResult = await launch(executable, userData, resultPath, args.timeoutMs);
    const parsed = JSON.parse(await readFile(resultPath, 'utf8'));
    validateNativeSmokeResult(parsed, userData);
    if (processResult.code !== 0) throw new Error(`packaged app exited ${processResult.code}`);
    await mkdir(output, { recursive: true });
    await copyFile(resultPath, resolve(output, 'native-smoke-result.json'));
    await writeFile(resolve(output, 'native-smoke-stdout.txt'), processResult.stdout, 'utf8');
    await writeFile(resolve(output, 'native-smoke-stderr.txt'), processResult.stderr, 'utf8');
    process.stdout.write('NATIVE_SMOKE_EXIT=0\nNATIVE_SMOKE_OK=true\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function launch(executable, userData, resultPath, timeoutMs) {
  const child = spawn(
    executable,
    [
      `--kerfdesk-native-smoke-user-data=${userData}`,
      `--kerfdesk-native-smoke-result=${resultPath}`,
    ],
    { cwd: dirname(executable), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const code = await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`packaged app exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (exitCode) => {
      clearTimeout(timeout);
      resolveExit(exitCode ?? 1);
    });
  });
  return { code, stdout, stderr };
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
