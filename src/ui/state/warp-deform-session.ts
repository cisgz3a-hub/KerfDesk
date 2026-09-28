// The live Warp or Deform session (LBG-T06): which artwork it bends, the box
// the handles started on, and where the handles are now. The tool mode says
// whether the tool is on; the handles live here so dragging one does not
// change the tool mode and re-render everything that watches it. Nothing here
// is project data: the artwork only changes when the session is applied.

import { create } from 'zustand';
import type { WarpDeformGrid } from '../../core/geometry/warp-deform-map';
import type { Bounds, Vec2 } from '../../core/scene/scene-object';

export type WarpDeformRequest = {
  readonly grid: WarpDeformGrid;
  readonly objectIds: ReadonlyArray<string>;
  /** World box the handles started on; the maps are defined over it. */
  readonly box: Bounds;
  /** World handle positions, in the order initialWarpDeformHandles gives. */
  readonly handles: ReadonlyArray<Vec2>;
};

type WarpDeformSessionState = {
  readonly session: WarpDeformRequest | null;
  readonly setSession: (next: WarpDeformRequest | null) => void;
  readonly setHandles: (handles: ReadonlyArray<Vec2>) => void;
};

export const useWarpDeformSession = create<WarpDeformSessionState>((set) => ({
  session: null,
  setSession: (next) => set({ session: next }),
  setHandles: (handles) =>
    set((state) => (state.session === null ? state : { session: { ...state.session, handles } })),
}));
