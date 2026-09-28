// Proves a packaged app refuses to start from a modified app.asar (ADR-483's
// enableEmbeddedAsarIntegrityValidation fuse, checked on every pull request by
// ADR-522). One hex digit of a file hash in the archive header is changed, so
// the header stays valid JSON and keeps its length but no longer matches the
// hash electron-builder embedded in the executable. The app is then launched on
// a throwaway profile with the native smoke switches: a refusing app stops
// before main.js runs and never writes a smoke result. Windows and macOS
// enforce this; Linux has no embedded hash.
//
// The archive is changed in place and put back afterwards, so run this only on
// a disposable package, after every other check on it has passed.
//
// usage: node scripts/verify-asar-integrity-enforced.mjs <executable> <app.asar> [--timeout-ms=N]

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_KEY = '"hash":"';
const DEFAULT_TIMEOUT_MS = 30_000;
// Electron's asar reader logs this before it stops the process.
const INTEGRITY_FAILURE = 'Integrity check failed for asar archive';

/**
 * Where to change one byte of the archive header: the first digit of the first
 * file hash. `prefix` is at least the first 16 bytes of the archive, `header`
 * the header JSON bytes that follow them.
 */
export function headerTamper(prefix, header) {
  if (prefix.length < 16) throw new Error('archive is too short to hold an asar header');
  const headerLength = prefix.readUInt32LE(12);
  if (header.length < headerLength) throw new Error('archive header is truncated');
  const at = header.subarray(0, headerLength).indexOf(HASH_KEY);
  if (at === -1) throw new Error('archive header records no file hashes');
  const index = at + HASH_KEY.length;
  const original = header[index];
  if (!/[0-9a-f]/.test(String.fromCharCode(original))) {
    throw new Error('archive header hash is not lowercase hex');
  }
  const replacement = original === 0x30 ? 0x31 : 0x30;
  return { offset: 16 + index, original, replacement };
}

/** Whether one launch of the tampered package shows the app refused to start. */
export function integrityVerdict({ code, signal, timedOut, resultWritten, stderr }) {
  if (resultWritten) return { refused: false, reason: 'the app started and wrote a smoke result' };
  if (stderr.includes(INTEGRITY_FAILURE)) return { refused: true, reason: INTEGRITY_FAILURE };
  if (timedOut)
    return { refused: false, reason: 'the app neither stopped nor reported an integrity failure' };
  if (code === 0 && signal === null) {
    return {
      refused: false,
      reason: 'the app exited cleanly without reporting an integrity failure',
    };
  }
  return {
    refused: true,
    reason: `the app stopped at launch (exit ${code}, signal ${signal ?? 'none'})`,
  };
}

function readHeader(asarPath) {
  const descriptor = openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    readSync(descriptor, prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    readSync(descriptor, header, 0, header.length, 16);
    return { prefix, header };
  } finally {
    closeSync(descriptor);
  }
}

function writeByte(asarPath, offset, value) {
  const descriptor = openSync(asarPath, 'r+');
  try {
    writeSync(descriptor, Buffer.from([value]), 0, 1, offset);
  } finally {
    closeSync(descriptor);
  }
}

function launch(executable, timeoutMs) {
  const root = mkdtempSync(join(tmpdir(), 'kerfdesk-asar-integrity-'));
  const resultPath = join(root, 'native-smoke-result.json');
  const userData = join(root, 'user-data');
  return new Promise((resolveLaunch) => {
    let stderr = '';
    let settled = false;
    const child = spawn(
      executable,
      [
        `--kerfdesk-native-smoke-user-data=${userData}`,
        `--kerfdesk-native-smoke-result=${resultPath}`,
      ],
      {
        cwd: dirname(executable),
        stdio: ['ignore', 'ignore', 'pipe'],
        // Chromium writes its fatal log line to stderr only when asked to.
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      },
    );
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      const resultWritten = existsSync(resultPath);
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // A killed app can hold its profile briefly; the directory is in the temp folder.
      }
      resolveLaunch({ ...outcome, resultWritten, stderr });
    };
    const timer = setTimeout(() => settle({ code: null, signal: null, timedOut: true }), timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      // A crash dialog can keep a refusing process alive; the log line decides.
      if (stderr.includes(INTEGRITY_FAILURE)) settle({ code: null, signal: null, timedOut: false });
    });
    child.on('error', (error) => {
      stderr += `\nspawn failed: ${error.message}`;
      settle({ code: null, signal: null, timedOut: false });
    });
    // 'close' waits for stderr to drain, so a late log line still counts.
    child.on('close', (code, signal) => settle({ code, signal, timedOut: false }));
  });
}

async function runCli() {
  const args = process.argv.slice(2);
  const [executable, asarPath] = args.filter((arg) => !arg.startsWith('--'));
  if (executable === undefined || asarPath === undefined || !isAbsolute(executable)) {
    throw new Error(
      'usage: verify-asar-integrity-enforced.mjs <absolute executable> <app.asar> [--timeout-ms=N]',
    );
  }
  const timeoutArg = args.find((arg) => arg.startsWith('--timeout-ms='));
  const timeoutMs = timeoutArg === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutArg.slice(13));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be positive');
  const archive = resolve(asarPath);
  const { prefix, header } = readHeader(archive);
  const tamper = headerTamper(prefix, header);
  writeByte(archive, tamper.offset, tamper.replacement);
  let observed;
  try {
    observed = await launch(executable, timeoutMs);
  } finally {
    writeByte(archive, tamper.offset, tamper.original);
  }
  const verdict = integrityVerdict(observed);
  process.stdout.write(`${observed.stderr.trim().slice(-4000)}\n`);
  if (!verdict.refused) throw new Error(`modified app.asar was not refused: ${verdict.reason}`);
  process.stdout.write(`ASAR_INTEGRITY_ENFORCED=true (${verdict.reason})\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await runCli().catch((error) => {
    process.stderr.write(`asar integrity check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
