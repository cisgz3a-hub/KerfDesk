// The snapping slice of the UI store: the persisted snap preference and the
// transient feedback it drives (alignment guides and the snap marker). Split out
// of ui-store.ts so that file stays under the size cap; the fields are read from
// useUiStore exactly as before.

import type { SnapMarker } from '../workspace/snap/snap-kinds';
import { sameSnapMarker } from '../workspace/snap/snap-kinds';
import {
  normalizeSnapSettings,
  sameSnapSettings,
  type SnapSettings,
} from '../workspace/snap-settings';
import type { SnapGuide } from '../workspace/snapping';
import { snapGuideStateUpdate } from './snap-guide-state';
import { hasPendingComputerPreference } from './preference-persistence';
import { readSnapSettings, SNAP_SETTINGS_KEY, writeSnapSettings } from './snap-preferences';

export type UiSnapState = {
  readonly snapSettings: SnapSettings;
  // Merges, clamps and persists. Out-of-range numbers are clamped, never refused.
  readonly setSnapSettings: (next: Partial<SnapSettings>) => void;
  readonly snapGuides: ReadonlyArray<SnapGuide>;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
  // What the pointer snapped to right now, drawn as a per-kind glyph.
  readonly snapMarker: SnapMarker | null;
  readonly setSnapMarker: (next: SnapMarker | null) => void;
};

type SnapSetter = (
  partial: Partial<UiSnapState> | ((state: UiSnapState) => Partial<UiSnapState>),
) => void;

export function uiSnapSlice(set: SnapSetter): UiSnapState {
  return {
    snapSettings: readSnapSettings(),
    setSnapSettings: (next) =>
      set((state) => {
        const merged = normalizeSnapSettings(
          { ...state.snapSettings, ...next },
          state.snapSettings,
        );
        const unchanged = sameSnapSettings(merged, state.snapSettings);
        if (unchanged && !hasPendingComputerPreference(SNAP_SETTINGS_KEY)) return state;
        writeSnapSettings(merged);
        if (unchanged) return state;
        return { snapSettings: merged };
      }),
    snapGuides: [],
    setSnapGuides: (next) => set((state) => snapGuideStateUpdate(state, next)),
    snapMarker: null,
    setSnapMarker: (next) =>
      set((state) => (sameSnapMarker(state.snapMarker, next) ? state : { snapMarker: next })),
  };
}
