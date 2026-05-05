/**
 * T2-105: crash-loop detection + safe-mode trigger. Pre-T2-105 there
 * was no startup-attempt accounting — when the app failed to open,
 * the user's only recourse was reinstall. Audit 5B Critical 9 +
 * Required Priority 13 calls for: a startup log on disk, a safe
 * mode after N consecutive failures, and a reset-settings escape
 * hatch.
 *
 * T2-105 ships the pure logic — record/clear startup attempts, count
 * consecutive crashes, decide whether to enter safe mode, format the
 * startup log line. The Electron-side wiring (process.on('uncaught
 * Exception'), app.on('render-process-gone'), reading + writing
 * userData/startup-state.json, sending IPC to the renderer) is filed
 * as T2-105-followup since it touches `electron/main.ts`.
 */

/**
 * One persisted record. The detector retains a bounded window — the
 * last `maxHistory` entries — so a long-lived install with many
 * historic startups doesn't grow the file unbounded.
 */
export interface StartupAttempt {
  startedAt: number;
  /**
   * `success` — startup completed cleanly (renderer ack received +
   * after a stable period without crashing).
   * `crash` — process exited or the renderer crashed before stable.
   * `in-progress` — the process recorded a startup attempt and has
   * not yet acknowledged success; treated as a crash on the next
   * boot (the "we crashed before we could record success" case).
   */
  outcome: 'success' | 'crash' | 'in-progress';
  /** Failure reason — error message, exit code, etc. Free-form. */
  reason?: string;
}

export interface CrashLoopState {
  attempts: StartupAttempt[];
  /**
   * Bumped when the user explicitly clears the loop (reset settings,
   * "I fixed it" button). Lets safe mode know that a clean state
   * follows even if older entries are still in the window.
   */
  resetGenerationAt?: number;
}

export interface CrashLoopDetectorOptions {
  /** Threshold for entering safe mode. Audit recommends 3. */
  safeModeThreshold: number;
  /** Window size — older attempts evicted from `attempts`. */
  maxHistory: number;
}

export const DEFAULT_OPTIONS: CrashLoopDetectorOptions = {
  safeModeThreshold: 3,
  maxHistory: 10,
};

export function emptyCrashLoopState(): CrashLoopState {
  return { attempts: [] };
}

/**
 * Append an `in-progress` record. Call at the very start of main
 * process boot — BEFORE any code that might throw. On the next boot,
 * any `in-progress` entry is treated as a crash (the host crashed
 * before it could record success).
 */
export function recordStartupAttempt(
  state: CrashLoopState,
  startedAt: number,
  options: CrashLoopDetectorOptions = DEFAULT_OPTIONS,
): CrashLoopState {
  const attempts = [
    ...state.attempts,
    { startedAt, outcome: 'in-progress' as const },
  ];
  // Trim from the FRONT; oldest evicted first.
  const trimmed = attempts.length > options.maxHistory
    ? attempts.slice(attempts.length - options.maxHistory)
    : attempts;
  return { ...state, attempts: trimmed };
}

/**
 * Mark the most recent attempt as successful. Call from the
 * renderer-ready handler.
 */
export function recordSuccessfulStart(state: CrashLoopState): CrashLoopState {
  if (state.attempts.length === 0) return state;
  const next = [...state.attempts];
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, outcome: 'success' };
  return { ...state, attempts: next };
}

/**
 * Mark the most recent attempt as crashed. Call from the
 * uncaughtException / render-process-gone handler.
 */
export function recordCrash(
  state: CrashLoopState,
  reason: string,
): CrashLoopState {
  if (state.attempts.length === 0) {
    return { ...state, attempts: [{ startedAt: 0, outcome: 'crash', reason }] };
  }
  const next = [...state.attempts];
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, outcome: 'crash', reason };
  return { ...state, attempts: next };
}

/**
 * Boot-time normalisation: any `in-progress` entry from a prior boot
 * is upgraded to a `crash` (the host died before it could record
 * success). Returns `{ state, recoveredCrashes }` so the caller can
 * record a startup-log line for each silent crash.
 */
export function reconcileOnBoot(state: CrashLoopState): {
  state: CrashLoopState;
  recoveredCrashes: number;
} {
  let recovered = 0;
  const next = state.attempts.map((a) => {
    if (a.outcome === 'in-progress') {
      recovered += 1;
      return { ...a, outcome: 'crash' as const, reason: a.reason ?? 'host died before recording success' };
    }
    return a;
  });
  return { state: { ...state, attempts: next }, recoveredCrashes: recovered };
}

/**
 * Count of crashes since the most recent success. A clean boot
 * resets the count to 0; consecutive failures accumulate. Reset-
 * generation timestamp also acts as a barrier — anything before it
 * is ignored even if it was a crash.
 */
export function consecutiveCrashCount(state: CrashLoopState): number {
  let count = 0;
  for (let i = state.attempts.length - 1; i >= 0; i--) {
    const a = state.attempts[i];
    if (state.resetGenerationAt != null && a.startedAt < state.resetGenerationAt) break;
    if (a.outcome === 'success') break;
    if (a.outcome === 'crash') count += 1;
    // 'in-progress' is treated as not-yet-counted — reconcileOnBoot
    // upgrades it to 'crash' before this is read.
  }
  return count;
}

export function shouldEnterSafeMode(
  state: CrashLoopState,
  options: CrashLoopDetectorOptions = DEFAULT_OPTIONS,
): boolean {
  return consecutiveCrashCount(state) >= options.safeModeThreshold;
}

/**
 * User explicitly chose "reset" / "I fixed it" — bump the reset
 * barrier. Future consecutiveCrashCount calls ignore everything
 * before this timestamp.
 */
export function clearCrashLoop(state: CrashLoopState, now: number): CrashLoopState {
  return { ...state, resetGenerationAt: now };
}

/**
 * Format one line for the startup log. Append-only, ISO-prefixed —
 * the file is the artifact a support engineer reads first when "the
 * app won't open."
 */
export function formatStartupLogLine(args: {
  at: number;
  level: 'INFO' | 'CRASH' | 'UNHANDLED_REJECTION' | 'RENDERER_CRASH' | 'SAFE_MODE';
  message: string;
}): string {
  return `[${new Date(args.at).toISOString()}] ${args.level}: ${args.message}\n`;
}
