import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { collectNativeSmokeProcess, nativeSmokeLaunchOptions } from './native-smoke-process.mjs';

export { nativeSmokeLaunchOptions };

/** Keep every attempt separate, including failures beside an older successful attempt. */
export async function runIsolatedNativeSmoke(args, validateResult, dependencies = {}) {
  const io = dependencies.io ?? filesystem;
  const output = resolve(args.output ?? 'artifacts/native-smoke');
  await io.mkdir(output, { recursive: true });
  const evidenceDirectory = await io.mkdtemp(resolve(output, 'run-'));
  const context = {
    io,
    evidenceDirectory,
    validateResult,
    root: null,
    tempBase: resolve(dependencies.tempBase ?? tmpdir()),
    manifest: {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      outcome: 'running',
      executable: resolve(args.executable),
      timeoutMs: args.timeoutMs,
      failure: null,
      validationFailure: null,
      evidenceErrors: [],
      cleanup: 'not-created',
      process: null,
      rawResult: 'missing',
    },
  };
  dependencies.reportEvidence?.(evidenceDirectory);
  // A failed initial publication cannot launch a process whose evidence is unrecordable.
  try {
    await publishManifest(context);
    await io.writeFile(resolve(evidenceDirectory, 'native-smoke-stdout.txt'), '');
    await io.writeFile(resolve(evidenceDirectory, 'native-smoke-stderr.txt'), '');
  } catch (error) {
    context.manifest.evidenceErrors.push(`initial evidence: ${error.message}`);
    recordFailure(context, 'evidence', error.message);
  }
  if (context.manifest.failure === null) await executeSmoke(context, args, dependencies);
  await finalizeEvidence(context);
  return { evidenceDirectory, manifest: context.manifest };
}

async function executeSmoke(context, args, dependencies) {
  try {
    context.root = await context.io.mkdtemp(resolve(context.tempBase, 'kerfdesk-native-smoke-'));
    const [ownedRoot, ownedBase] = await Promise.all([
      context.io.realpath(context.root),
      context.io.realpath(context.tempBase),
    ]);
    if (
      dirname(ownedRoot) !== ownedBase ||
      !basename(ownedRoot).startsWith('kerfdesk-native-smoke-')
    ) {
      throw new Error('created disposable profile resolved outside its owned temporary parent');
    }
    context.ownedRoot = ownedRoot;
    const userData = resolve(context.root, 'user-data');
    const resultPath = resolve(context.root, 'native-smoke-result.json');
    Object.assign(context.manifest, { profileRoot: context.root, userData, cleanup: 'pending' });
    await context.io.mkdir(userData);
    await publishManifest(context);
    const observed = await collectNativeSmokeProcess(
      context.manifest.executable,
      [
        `--kerfdesk-native-smoke-user-data=${userData}`,
        `--kerfdesk-native-smoke-result=${resultPath}`,
      ],
      { ...dependencies, timeoutMs: args.timeoutMs },
    );
    const { stdout, stderr, ...processResult } = observed;
    context.manifest.process = processResult;
    context.manifest.failure = observed.failure;
    if (observed.code !== 0)
      recordFailure(
        context,
        'exit',
        `packaged app exited ${observed.code} (signal ${observed.signal ?? 'none'})`,
      );
    await preserve(context, 'native-smoke-stdout.txt', stdout);
    await preserve(context, 'native-smoke-stderr.txt', stderr);
    await captureResult(context, resultPath, userData);
  } catch (error) {
    recordFailure(context, 'runner', error.message);
  }
}

async function captureResult(context, resultPath, userData) {
  let raw;
  try {
    raw = await context.io.readFile(resultPath);
    context.manifest.rawResult = 'captured';
  } catch (error) {
    context.manifest.rawResult = error.code === 'ENOENT' ? 'missing' : 'unreadable';
    context.manifest.validationFailure = `result ${context.manifest.rawResult}: ${error.message}`;
    if (context.manifest.rawResult === 'unreadable') {
      context.manifest.evidenceErrors.push(`native-smoke-result.json: ${error.message}`);
    }
    recordFailure(context, 'result', context.manifest.validationFailure);
    return;
  }
  // Preserve and validate the same bytes, even if an unclosed child changes its source later.
  await preserve(context, 'native-smoke-result.json', raw);
  try {
    context.validateResult(JSON.parse(raw.toString('utf8')), userData);
  } catch (error) {
    context.manifest.validationFailure = error.message;
    recordFailure(context, 'validation', error.message);
  }
}

async function preserve(context, filename, data) {
  try {
    await context.io.writeFile(resolve(context.evidenceDirectory, filename), data);
  } catch (error) {
    context.manifest.evidenceErrors.push(`${filename}: ${error.message}`);
    recordFailure(context, 'evidence', error.message);
  }
}

async function finalizeEvidence(context) {
  const manifest = context.manifest;
  // Never leave a passing manifest if cleanup or final evidence publication fails.
  manifest.outcome = 'finalizing';
  await preserve(context, 'manifest.json', JSON.stringify(manifest, null, 2));
  if (context.root !== null) {
    if (manifest.process?.childClosed && manifest.evidenceErrors.length === 0) {
      await cleanupProfile(context);
    } else {
      manifest.cleanup = 'retained';
    }
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.outcome = manifest.failure === null ? 'success' : 'failure';
  try {
    await publishManifest(context);
  } catch (error) {
    manifest.evidenceErrors.push(`manifest.json: ${error.message}`);
    recordFailure(context, 'evidence', error.message);
    manifest.outcome = 'failure';
    // The preceding on-disk manifest is still non-passing. Do not claim crash durability.
  }
}

async function cleanupProfile(context) {
  try {
    const actualRoot = await context.io.realpath(context.root);
    if (actualRoot !== context.ownedRoot) {
      throw new Error('disposable profile no longer resolves to its created directory');
    }
    await context.io.rm(context.root, { recursive: true, force: true });
    context.manifest.cleanup = 'removed';
  } catch (error) {
    context.manifest.cleanup = 'failed-may-be-partial';
    context.manifest.cleanupError = error.message;
    recordFailure(context, 'cleanup', error.message);
  }
}

function recordFailure(context, kind, message) {
  const candidate = { kind, message };
  const current = context.manifest.failure;
  if (current === null || failurePriority(candidate) > failurePriority(current)) {
    context.manifest.failure = candidate;
  }
}

function failurePriority(failure) {
  if (
    ['timeout', 'process-error', 'spawn-error', 'stdout-error', 'stderr-error', 'exit'].includes(
      failure.kind,
    )
  )
    return 3;
  if (failure.kind === 'validation') return 2;
  if (failure.kind === 'result' || failure.kind === 'runner') return 1;
  return 0;
}

async function publishManifest(context) {
  const pending = resolve(context.evidenceDirectory, 'manifest.pending.json');
  await context.io.writeFile(pending, `${JSON.stringify(context.manifest, null, 2)}\n`);
  await context.io.rename(pending, resolve(context.evidenceDirectory, 'manifest.json'));
}
