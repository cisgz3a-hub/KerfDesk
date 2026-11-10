// set-origin-placement — what a confirmed Set origin does to Start from.
// Shared by the PC Origin row and the remote Set origin so both follow
// ADR-327 item 4 (audit 2026-10-21 01-P2-2: the remote skipped it).

import { canvasTargetInScene } from '../camera/calibrate/canvas-target-burn';
import { useStore, type AppState } from '../state/store';

type PlacementStore = { readonly getState: () => AppState };

// Set origin upgrades Absolute Coordinates to User Origin. An explicit
// User, Verified, or Current Position choice is the operator's and is
// never rewritten under them (ADR-193; ADR-327). The mode is read when the
// controller acknowledges, not when the action began: Set origin waits up to
// a few seconds for the work-offset frame and the dropdown may change meanwhile.
// The controller origin is global, but its placement update belongs only to
// the document in which the operator set it, even if New/Open ran meanwhile.
//
// The camera target's rings are the exception (ADR-441 Amendment 10, rolling
// audit v13 Y3-P1-2): they burn where the calibration photo reads them only
// at Absolute Coordinates, so Set origin leaves Absolute in place and says so.
export type SetOriginPlacement = 'unchanged' | 'user-origin' | 'kept-for-camera-target';

export function placementAfterSetOrigin(
  documentEpoch: number,
  store: PlacementStore = useStore,
): SetOriginPlacement {
  const state = store.getState();
  if (state.projectDocumentEpoch !== documentEpoch) return 'unchanged';
  if (state.jobPlacement.startFrom !== 'absolute') return 'unchanged';
  if (canvasTargetInScene(state.project)) return 'kept-for-camera-target';
  state.setJobPlacement({ startFrom: 'user-origin' });
  return 'user-origin';
}

/** The Set origin toast, saying what happened to Start from. */
export function setOriginToast(
  placement: SetOriginPlacement,
  set = 'Origin set to current head position (G92).',
): string {
  if (placement === 'user-origin') return `${set} Start from is now User Origin.`;
  if (placement === 'kept-for-camera-target') {
    return `${set} Start from stays Absolute Coordinates: the camera target on the canvas burns where the calibration photo expects it only there.`;
  }
  return set;
}
