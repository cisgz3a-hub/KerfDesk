/**
 * T2-51: atomic `CompiledJobState` discriminated union. Pre-T2-51
 * the compile state in `useCompileManager.ts:68-79` was 5 React
 * states + 4 refs (currentGcode, lastResult, isCompiling,
 * sceneCompileTick, sceneCompileTickRef, lastCompiledRevisionRef,
 * gcodeStale, gcodeStaleRef) representing one logical concept.
 * `currentGcode` was updated by callers separately from `lastResult`
 * (set inside compileGcode), so they drifted.
 *
 * Audit 4A Critical Failure 2 + Duplication 1 + Required Fix 2.
 * T2-51 closes T1-56 / T1-57 / T1-58 structurally rather than by
 * patches: when `selectMachinePlanBounds` reads from the discriminated
 * state, the "wrong source" defect cannot exist by construction.
 *
 * T2-51 ships the type + the transition functions + the selector
 * suite. Migrating `useCompileManager` to use this state is filed as
 * T2-51-followup since it touches App.tsx + ConnectionPanelMain.tsx
 * + every preflight caller.
 */
import { type AABB } from '../core/types';

/**
 * Minimal shape of CompileGcodeResult. The actual production type
 * lives in `src/app/PipelineService.ts`; T2-51 declares the subset
 * the state contains so this module compiles independently.
 */
export interface CompileResultLike {
  gcode: string;
  machinePlanBounds: AABB;
  canvasBurnBounds?: AABB | null;
  canvasPlanBounds?: AABB;
  ticket: { ticketId: string };
  /** Optional fields the result may carry — not part of the contract. */
  [k: string]: unknown;
}

export type CompileStaleReason = 'scene-changed' | 'profile-changed' | 'machine-changed';

export type CompiledJobState =
  | { status: 'none' }
  | {
      status: 'compiling';
      requestId: number;
      sceneHash: string;
      profileHash: string;
      startedAt: number;
    }
  | {
      status: 'ready';
      requestId: number;
      sceneHash: string;
      profileHash: string;
      compiledAt: number;
      result: CompileResultLike;
    }
  | {
      status: 'stale';
      previousResult: CompileResultLike;
      previousSceneHash: string;
      previousProfileHash: string;
      reason: CompileStaleReason;
    }
  | {
      status: 'failed';
      error: string;
      sceneHash: string;
      profileHash: string;
      requestId: number;
    };

export type CompiledJobStatus = CompiledJobState['status'];

export const compiledJobStateInitial: CompiledJobState = { status: 'none' };

// ─── selectors ─────────────────────────────────────────────

export function selectGcode(s: CompiledJobState): string | null {
  return s.status === 'ready' ? s.result.gcode : null;
}

export function selectMachinePlanBounds(
  s: CompiledJobState,
): AABB | null {
  return selectCompiledMachineBounds(s);
}

export function selectCompiledMachineBounds(s: CompiledJobState): AABB | null {
  return s.status === 'ready' ? s.result.machinePlanBounds : null;
}

export function selectCompiledCanvasBounds(s: CompiledJobState): AABB | null {
  return s.status === 'ready' ? s.result.canvasPlanBounds ?? null : null;
}

export function selectTicket(s: CompiledJobState): { ticketId: string } | null {
  return s.status === 'ready' ? s.result.ticket : null;
}

export function selectIsStale(s: CompiledJobState): boolean {
  return s.status === 'stale';
}

export function selectIsCompiling(s: CompiledJobState): boolean {
  return s.status === 'compiling';
}

export function selectIsReady(s: CompiledJobState): boolean {
  return s.status === 'ready';
}

export function selectError(s: CompiledJobState): string | null {
  return s.status === 'failed' ? s.error : null;
}

/**
 * For a stale state, return the previous result so the UI can render
 * "this is the LAST compiled version, but it's stale because <reason>"
 * — the existing stale-with-preview UX.
 */
export function selectStaleResult(s: CompiledJobState): CompileResultLike | null {
  return s.status === 'stale' ? s.previousResult : null;
}

export function selectStaleReason(s: CompiledJobState): CompileStaleReason | null {
  return s.status === 'stale' ? s.reason : null;
}

// ─── transitions ───────────────────────────────────────────

/**
 * Begin a compile. Allocates a fresh `requestId` (caller-managed
 * monotonic counter — T1-57 race guard) and stamps `startedAt`.
 */
export function startCompile(args: {
  current: CompiledJobState;
  requestId: number;
  sceneHash: string;
  profileHash: string;
  now: number;
}): CompiledJobState {
  return {
    status: 'compiling',
    requestId: args.requestId,
    sceneHash: args.sceneHash,
    profileHash: args.profileHash,
    startedAt: args.now,
  };
}

/**
 * Compile completed successfully. Honours the request-id race
 * guard: if `current` is `compiling` with a different requestId
 * (a NEWER compile already started), this result is discarded —
 * out-of-order completions cannot overwrite the active compile.
 */
export function completeCompile(args: {
  current: CompiledJobState;
  requestId: number;
  sceneHash: string;
  profileHash: string;
  result: CompileResultLike;
  now: number;
}): CompiledJobState {
  // Out-of-order guard: if a newer compile is in flight, drop this one.
  if (args.current.status === 'compiling' && args.current.requestId !== args.requestId) {
    return args.current;
  }
  return {
    status: 'ready',
    requestId: args.requestId,
    sceneHash: args.sceneHash,
    profileHash: args.profileHash,
    compiledAt: args.now,
    result: args.result,
  };
}

/**
 * Compile failed. Same race guard as completeCompile.
 */
export function failCompile(args: {
  current: CompiledJobState;
  requestId: number;
  sceneHash: string;
  profileHash: string;
  error: string;
}): CompiledJobState {
  if (args.current.status === 'compiling' && args.current.requestId !== args.requestId) {
    return args.current;
  }
  return {
    status: 'failed',
    requestId: args.requestId,
    sceneHash: args.sceneHash,
    profileHash: args.profileHash,
    error: args.error,
  };
}

/**
 * Mark the compile stale. Only valid from a `ready` state — when
 * called on `none` / `compiling` / `stale` / `failed`, returns
 * `current` unchanged. The reason is one of the three audit-named
 * causes.
 */
export function markStale(
  current: CompiledJobState,
  reason: CompileStaleReason,
): CompiledJobState {
  if (current.status !== 'ready') return current;
  return {
    status: 'stale',
    previousResult: current.result,
    previousSceneHash: current.sceneHash,
    previousProfileHash: current.profileHash,
    reason,
  };
}

/**
 * Reset to `none` — used by load/new-project flows that explicitly
 * abandon the prior compile.
 */
export function clearCompiledJob(): CompiledJobState {
  return { status: 'none' };
}
