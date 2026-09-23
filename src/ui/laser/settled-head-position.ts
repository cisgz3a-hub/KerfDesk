// Settled head position for pre-job estimates.
//
// TIME-05 feeds the physical head position into the estimate so approach
// travel is counted in every placement mode. Sampled raw from every status
// report, that position changes ~4x/s for as long as a Frame, jog, probe or
// job moves the head, and each distinct value keys a fresh ADR-244 background
// preparation: a 60 s Frame over a large traced fill issued hundreds of full
// compiles, each one a complete prepared route, which exhausted the renderer.
//
// A moving head has no approach time worth estimating anyway - Frame returns
// to where it started, and a jog ends somewhere the operator has not decided
// on yet - so the estimate samples the head only once it is settled and holds
// that sample while it moves.

import { useEffect, useState } from 'react';
import type { MotionPoint } from '../../core/job/motion-manifest';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

type HeadSettlementState = Pick<
  LaserState,
  'statusReport' | 'motionOperation' | 'probeBusy' | 'autofocusBusy' | 'streamer' | 'mpgActive'
>;

/**
 * True when the controller reports Idle and nothing the app knows about is
 * moving the head: no owned Frame/jog leg (a Frame reports Idle between its
 * legs while the operation still owns the head), no probe or autofocus, no
 * streamed job, no MPG takeover.
 */
export function isHeadSettled(state: HeadSettlementState): boolean {
  return (
    state.statusReport?.state === 'Idle' &&
    state.motionOperation === null &&
    !state.probeBusy &&
    !state.autofocusBusy &&
    !isActiveJob(state.streamer) &&
    state.mpgActive !== true
  );
}

const HEAD_IN_MOTION = 'in-motion' as const;

type SettledHeadState = HeadSettlementState &
  Pick<LaserState, 'workOriginActive' | 'wcoCache' | 'controllerSettings'>;

/**
 * The last settled work position in mm, held unchanged while the head moves.
 * Undefined while no controller report exists (the estimate then carries no
 * approach travel, as before the position reached it). The value is memoised
 * on its coordinates, so identical polls never re-arm consumers' debounces.
 */
export function useSettledHeadPosition(): MotionPoint | undefined {
  // One derived selection instead of the raw report: the report is a fresh
  // object on every poll, which re-rendered the whole Workspace four times a
  // second through a job whose head sample this hook holds anyway.
  const sample = useLaserStore(settledHeadSample);
  const [held, setHeld] = useState<MotionPoint | undefined>(
    sample === HEAD_IN_MOTION ? undefined : sample,
  );
  useEffect(() => {
    // In motion with a live controller: keep the pre-motion sample.
    if (sample === HEAD_IN_MOTION) return;
    setHeld((current) => (samePoint(current, sample) ? current : sample));
  }, [sample]);
  return held;
}

let lastSettledPoint: MotionPoint | undefined;

/** Undefined with no report, HEAD_IN_MOTION while anything moves the head, else
 * the settled position — the same point object for as long as it stays put. */
function settledHeadSample(
  state: SettledHeadState,
): MotionPoint | undefined | typeof HEAD_IN_MOTION {
  if (state.statusReport === null) return undefined;
  if (!isHeadSettled(state)) return HEAD_IN_MOTION;
  const reported = reportedWorkPositionMm(state, state.controllerSettings?.reportInches === true);
  if (reported === null) return undefined;
  if (!samePoint(lastSettledPoint, reported)) {
    lastSettledPoint = { x: reported.x, y: reported.y, z: reported.z };
  }
  return lastSettledPoint;
}

function samePoint(left: MotionPoint | undefined, right: MotionPoint | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x && left.y === right.y && left.z === right.z;
}
