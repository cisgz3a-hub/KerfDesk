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
import {
  fingerprintDiff,
  fingerprintsEqual,
  type JobFingerprint,
} from '../core/job/JobFingerprint';

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
 * Service-level proof passed to MachineService.startValidatedJob().
 *
 * This is intentionally separate from FrameState: FrameState is a UI
 * lifecycle model, while FrameTicket is the exact proof the final
 * machine-control path needs before it streams bytes. It supports the
 * LightBurn-style normal path ("I framed this exact compiled job") and
 * the explicit advanced path ("I am intentionally starting without
 * framing, log that decision").
 */
export type FrameTicket =
  | {
      readonly kind: 'framed';
      readonly jobTicketId: string;
      readonly fingerprint: JobFingerprint;
      readonly machineBounds: AABB;
      readonly mode: FrameMode;
      readonly framedAt: number;
      readonly controllerIdentity?: string | null;
      readonly wcsState?: string | null;
    }
  | {
      readonly kind: 'unframed-start-override';
      readonly jobTicketId: string;
      readonly fingerprint: JobFingerprint;
      readonly reason: string;
      readonly grantedAt: number;
    };

export type FrameTicketStartValidation =
  | { readonly ok: true; readonly override: boolean; readonly reason?: string }
  | { readonly ok: false; readonly reason: string };

export function createFramedStartTicket(args: {
  jobTicketId: string;
  fingerprint: JobFingerprint;
  machineBounds: AABB;
  mode: FrameMode;
  framedAt?: number;
  controllerIdentity?: string | null;
  wcsState?: string | null;
}): FrameTicket {
  return {
    kind: 'framed',
    jobTicketId: args.jobTicketId,
    fingerprint: args.fingerprint,
    machineBounds: args.machineBounds,
    mode: args.mode,
    framedAt: args.framedAt ?? Date.now(),
    controllerIdentity: args.controllerIdentity ?? null,
    wcsState: args.wcsState ?? null,
  };
}

export function createUnframedStartOverrideTicket(args: {
  jobTicketId: string;
  fingerprint: JobFingerprint;
  reason: string;
  grantedAt?: number;
}): FrameTicket {
  return {
    kind: 'unframed-start-override',
    jobTicketId: args.jobTicketId,
    fingerprint: args.fingerprint,
    reason: args.reason,
    grantedAt: args.grantedAt ?? Date.now(),
  };
}

export function validateFrameTicketForStart(args: {
  frameTicket: FrameTicket | null | undefined;
  jobTicketId: string;
  fingerprint: JobFingerprint;
}): FrameTicketStartValidation {
  const frameTicket = args.frameTicket;
  if (!frameTicket) {
    return {
      ok: false,
      reason: 'Frame proof is missing. Frame the current job or explicitly choose Start without framing.',
    };
  }

  if (frameTicket.jobTicketId !== args.jobTicketId) {
    return {
      ok: false,
      reason: `Frame proof is for ticket ${frameTicket.jobTicketId}, not the current ticket ${args.jobTicketId}. Re-frame the current job.`,
    };
  }

  if (!fingerprintsEqual(frameTicket.fingerprint, args.fingerprint)) {
    const fields = fingerprintDiff(frameTicket.fingerprint, args.fingerprint);
    return {
      ok: false,
      reason: `Frame is stale for the current compiled job (fingerprint changed: ${fields.join(', ') || 'unknown'}). Re-frame, or explicitly choose Start without framing.`,
    };
  }

  if (frameTicket.kind === 'unframed-start-override' && frameTicket.reason.trim().length === 0) {
    return {
      ok: false,
      reason: 'Start without framing requires an override reason.',
    };
  }

  return {
    ok: true,
    override: frameTicket.kind === 'unframed-start-override',
    reason: frameTicket.kind === 'unframed-start-override' ? frameTicket.reason : undefined,
  };
}

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
