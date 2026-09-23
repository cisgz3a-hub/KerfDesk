import { useCallback } from 'react';
import {
  resolvePreviewJobPlacement,
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type ResolvedJobPlacement,
} from './job-placement';
import { isHeadSettled } from './laser/settled-head-position';
import { useLaserStore, type LaserState } from './state/laser-store';
import { sameInputs } from './state/memoize-on-inputs';

type PlacementSource = Parameters<typeof isHeadSettled>[0] &
  Pick<LaserState, 'workOriginActive' | 'wcoCache' | 'controllerSettings'>;

type HeldPlacement = {
  readonly inputs: ReadonlyArray<unknown>;
  readonly placement: ResolvedJobPlacement;
  readonly key: string;
};

// Keyed by the settings object every consumer reads from the same store, so the
// preview and both estimate mounts hold one placement: the worker cache keys on
// its jobOrigin, and a divergent hold would prepare the same job twice.
const heldPlacements = new WeakMap<JobPlacementSettings, HeldPlacement>();

/**
 * The placement Preview and the live estimate share (resolvePreviewJobPlacement),
 * selected without subscribing to the raw status report. A connected controller
 * stores a fresh report every 250 ms poll, and subscribing to it re-rendered the
 * whole Workspace per poll to recompute a placement that, outside Current
 * Position, depends only on the origin fields.
 */
export function usePreviewJobPlacement(settings: JobPlacementSettings): ResolvedJobPlacement {
  const select = useCallback(
    (state: PlacementSource) => selectPreviewJobPlacement(settings, state),
    [settings],
  );
  return useLaserStore(select);
}

/**
 * Same result as resolvePreviewJobPlacement(settings, live machine), returned
 * as the same object while its value is unchanged. Current Position follows the
 * settled head only (the useSettledHeadPosition rule): while a job, Frame, jog
 * or probe moves the head, the last placement holds instead of re-keying the
 * preview and estimate at every poll.
 */
export function selectPreviewJobPlacement(
  settings: JobPlacementSettings,
  state: PlacementSource,
): ResolvedJobPlacement {
  const held = heldPlacements.get(settings);
  const followsHead = settings.startFrom === 'current-position';
  // Only a resolved placement is worth holding. A failure left by a disconnect
  // would otherwise outlast the reconnect, which lands in Alarm (not settled)
  // until homing, although that report already gives the head's position.
  if (followsHead && held?.placement.ok === true && headInMotion(state)) return held.placement;
  const inputs = placementInputs(followsHead, state);
  if (held !== undefined && sameInputs(held.inputs, inputs)) return held.placement;
  const resolved = resolvePreviewJobPlacement(settings, placementMachine(state));
  const key = JSON.stringify(resolved);
  const placement = held !== undefined && held.key === key ? held.placement : resolved;
  heldPlacements.set(settings, { inputs, placement, key });
  return placement;
}

function headInMotion(state: PlacementSource): boolean {
  return state.statusReport !== null && !isHeadSettled(state);
}

// Exactly the fields the resolvers read. Only Current Position reads the report
// itself; every other mode reads the work offset through knownWco's
// `wcoCache ?? statusReport.wco`, which is stable between WCO frames.
function placementInputs(followsHead: boolean, state: PlacementSource): ReadonlyArray<unknown> {
  const reportInches = state.controllerSettings?.reportInches === true;
  return followsHead
    ? [state.statusReport, state.wcoCache, state.workOriginActive, reportInches]
    : [state.wcoCache ?? state.statusReport?.wco ?? null, state.workOriginActive, reportInches];
}

function placementMachine(state: PlacementSource): MachinePlacementSnapshot {
  return {
    statusReport: state.statusReport,
    workOriginActive: state.workOriginActive,
    wcoCache: state.wcoCache,
    reportInches: state.controllerSettings?.reportInches === true,
  };
}
