/**
 * T2-86: explicit `FrameState` union type. Pre-T2-86 frame state was
 * a single boolean (`hasFramedRef.current`); real states include
 * "in progress," "failed with reason," "valid for fingerprint X,"
 * "stale because Y" — distinctions a boolean cannot express. The
 * audit (4F Critical 3 + Priority 4) calls this out as the type
 * formalization that pairs with T2-60 (frame freshness invalidation
 * triggers, already shipped).
 *
 * This commit ships the type + transition helpers as pure data;
 * the audit's full proposal also threads `FrameState` through
 * `ConnectionPanelMain` to drive UI copy + the `canStart` rule.
 * That migration is filed as T2-86-followup since 17+ call sites
 * read `hasFramedRef.current` and the migration touches every
 * Start/Frame button gate.
 */

import type { AABB } from '../core/types';

/** Frame mode: 'safe' = full perimeter at low power; 'dot' = corner marker. */
export type FrameMode = 'safe' | 'dot';

/** Reasons an existing frame becomes invalid. Same set the T2-60
 *  invalidation effect monitors; T2-86 formalizes them. */
export type FrameStaleReason =
  | 'scene-changed'
  | 'profile-changed'
  | 'origin-changed'
  | 'startmode-changed'
  | 'undo-redo'
  | 'project-loaded'
  | 'manual-invalidate';

/** Reasons a frame attempt failed. */
export type FrameFailureReason =
  | 'no-controller'
  | 'idle-timeout'
  | 'command-failed'
  | 'machine-alarm'
  | 'disconnected'
  | 'cancelled'
  | 'unknown';

/**
 * The `valid.fingerprint` is a JobFingerprint string (T2-85).
 * Carrying it here lets the canStart rule check that the frame still
 * matches the current job — the user could undo back to a frame's
 * scene, redo forward to a different scene, and the frame would be
 * rejected without the user having to re-frame.
 */
export type FrameState =
  | { status: 'none' }
  | { status: 'running'; startedAt: number; mode: FrameMode }
  | {
      status: 'valid';
      fingerprint: string;        // T2-85 JobFingerprint
      bounds: AABB;
      mode: FrameMode;
      completedAt: number;
    }
  | {
      status: 'stale';
      previousFingerprint?: string;
      reason: FrameStaleReason;
    }
  | {
      status: 'failed';
      reason: FrameFailureReason;
      failedAt: number;
    };

/**
 * Predicate: does this frame state allow Start? Only `'valid'` does;
 * the caller still has to compare fingerprints separately.
 */
export function frameAllowsStart(state: FrameState): boolean {
  return state.status === 'valid';
}

/**
 * Returns true when the frame matches the given current job
 * fingerprint. False for any non-valid state, or when the fingerprint
 * differs (e.g. user modified scene since framing). Combine with
 * `frameAllowsStart` for the full canStart rule.
 */
export function frameMatchesFingerprint(state: FrameState, currentFingerprint: string): boolean {
  return state.status === 'valid' && state.fingerprint === currentFingerprint;
}

// ─── Transition builders ───────────────────────────────────────

export function frameStateNone(): FrameState {
  return { status: 'none' };
}

export function frameStateRunning(mode: FrameMode, now: number = Date.now()): FrameState {
  return { status: 'running', startedAt: now, mode };
}

export function frameStateValid(args: {
  fingerprint: string;
  bounds: AABB;
  mode: FrameMode;
  now?: number;
}): FrameState {
  return {
    status: 'valid',
    fingerprint: args.fingerprint,
    bounds: args.bounds,
    mode: args.mode,
    completedAt: args.now ?? Date.now(),
  };
}

export function frameStateStale(reason: FrameStaleReason, previous?: FrameState): FrameState {
  return {
    status: 'stale',
    previousFingerprint:
      previous && previous.status === 'valid' ? previous.fingerprint : undefined,
    reason,
  };
}

export function frameStateFailed(reason: FrameFailureReason, now: number = Date.now()): FrameState {
  return { status: 'failed', reason, failedAt: now };
}
