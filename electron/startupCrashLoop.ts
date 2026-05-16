import * as fs from 'fs';
import * as path from 'path';

export interface StartupCrashLoopState {
  bootInProgress: boolean;
  consecutiveFailures: number;
  lastStartedAt?: number;
  lastSuccessfulAt?: number;
  lastFailureReason?: string;
  updatedAt: number;
}

export interface StartupCrashLoopStatus {
  consecutiveFailures: number;
  recoveredPreviousFailure: boolean;
  shouldEnterSafeMode: boolean;
  statePath: string;
  lastFailureReason?: string;
}

const DEFAULT_SAFE_MODE_THRESHOLD = 3;
const STATE_FILE = 'startup-crash-loop.json';

function emptyState(now: number): StartupCrashLoopState {
  return {
    bootInProgress: false,
    consecutiveFailures: 0,
    updatedAt: now,
  };
}

export function startupCrashLoopStatePath(userDataPath: string): string {
  return path.join(userDataPath, STATE_FILE);
}

function readState(userDataPath: string, now: number): StartupCrashLoopState {
  const file = startupCrashLoopStatePath(userDataPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StartupCrashLoopState>;
    return {
      bootInProgress: parsed.bootInProgress === true,
      consecutiveFailures: Number.isInteger(parsed.consecutiveFailures)
        ? Math.max(0, parsed.consecutiveFailures ?? 0)
        : 0,
      lastStartedAt: typeof parsed.lastStartedAt === 'number' ? parsed.lastStartedAt : undefined,
      lastSuccessfulAt: typeof parsed.lastSuccessfulAt === 'number' ? parsed.lastSuccessfulAt : undefined,
      lastFailureReason: typeof parsed.lastFailureReason === 'string' ? parsed.lastFailureReason : undefined,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
    };
  } catch {
    return emptyState(now);
  }
}

function writeState(userDataPath: string, state: StartupCrashLoopState): void {
  fs.mkdirSync(userDataPath, { recursive: true });
  const file = startupCrashLoopStatePath(userDataPath);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fileFd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fileFd, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fileFd);
  } finally {
    fs.closeSync(fileFd);
  }
  fs.renameSync(tmp, file);
  try {
    const dirFd = fs.openSync(userDataPath, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Best-effort: some Windows/filesystem combinations do not support
    // opening directories for fsync. The temp-file fsync above is still
    // mandatory before the atomic rename.
  }
}

export function beginStartupCrashLoopTracking(
  userDataPath: string,
  now = Date.now(),
  safeModeThreshold = DEFAULT_SAFE_MODE_THRESHOLD,
): StartupCrashLoopStatus {
  const previous = readState(userDataPath, now);
  const recoveredPreviousFailure = previous.bootInProgress;
  const consecutiveFailures = previous.consecutiveFailures + (recoveredPreviousFailure ? 1 : 0);
  const lastFailureReason = recoveredPreviousFailure
    ? 'host died before recording successful startup'
    : previous.lastFailureReason;
  writeState(userDataPath, {
    ...previous,
    bootInProgress: true,
    consecutiveFailures,
    lastStartedAt: now,
    lastFailureReason,
    updatedAt: now,
  });
  return {
    consecutiveFailures,
    recoveredPreviousFailure,
    shouldEnterSafeMode: consecutiveFailures >= safeModeThreshold,
    statePath: startupCrashLoopStatePath(userDataPath),
    lastFailureReason,
  };
}

export function markStartupSuccessful(userDataPath: string, now = Date.now()): void {
  const previous = readState(userDataPath, now);
  writeState(userDataPath, {
    ...previous,
    bootInProgress: false,
    consecutiveFailures: 0,
    lastSuccessfulAt: now,
    lastFailureReason: undefined,
    updatedAt: now,
  });
}

export function recordStartupCrash(
  userDataPath: string,
  reason: string,
  now = Date.now(),
): StartupCrashLoopStatus {
  const previous = readState(userDataPath, now);
  const consecutiveFailures = previous.consecutiveFailures + 1;
  writeState(userDataPath, {
    ...previous,
    bootInProgress: false,
    consecutiveFailures,
    lastFailureReason: reason,
    updatedAt: now,
  });
  return {
    consecutiveFailures,
    recoveredPreviousFailure: false,
    shouldEnterSafeMode: consecutiveFailures >= DEFAULT_SAFE_MODE_THRESHOLD,
    statePath: startupCrashLoopStatePath(userDataPath),
    lastFailureReason: reason,
  };
}
