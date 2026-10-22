// set-origin-placement — what a confirmed Set origin does to Start from.
// Shared by the PC Origin row and the remote Set origin so both follow
// ADR-327 item 4 (audit 2026-10-21 01-P2-2: the remote skipped it).

import { useStore, type AppState } from '../state/store';

type PlacementStore = { readonly getState: () => AppState };

// Set origin upgrades Absolute Coordinates to User Origin. An explicit
// User, Verified, or Current Position choice is the operator's and is
// never rewritten under them (ADR-193; ADR-327). The mode is read when the
// controller acknowledges, not when the action began: Set origin waits up to
// a few seconds for the work-offset frame and the dropdown may change meanwhile.
// The controller origin is global, but its placement update belongs only to
// the document in which the operator set it, even if New/Open ran meanwhile.
export function placementAfterSetOrigin(
  documentEpoch: number,
  store: PlacementStore = useStore,
): void {
  const state = store.getState();
  if (state.projectDocumentEpoch !== documentEpoch) return;
  if (state.jobPlacement.startFrom === 'absolute')
    state.setJobPlacement({ startFrom: 'user-origin' });
}
