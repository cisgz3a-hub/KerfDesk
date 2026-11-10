// design-store-slices — groups of Design Studio store actions kept out of
// design-studio-store.ts, which sits at the file-size cap (ADR-272 Amendments
// 6 and 7). Each slice is plain zustand wiring over a pure session transition.

import type { DesignSession } from './design-session';
import type { DesignStudioState } from './design-studio-store';
import {
  dimensionSessionAt,
  driveSessionDimension,
  setSessionDimensionDriving,
} from './design-dimension-session';

type SetState = (change: (state: DesignStudioState) => Partial<DesignStudioState>) => void;

export function dimensionActions(
  set: SetState,
): Pick<
  DesignStudioState,
  'dimensionAt' | 'setActiveDimension' | 'driveDimension' | 'setDimensionDriving'
> {
  return {
    dimensionAt: (atMm, toleranceMm, newId) =>
      set(mapSession((session) => dimensionSessionAt(session, atMm, toleranceMm, newId))),
    setActiveDimension: (activeDimensionId) =>
      set(
        mapSession((session) => ({ ...session, activeDimensionId, dimensionPendingLineId: null })),
      ),
    driveDimension: (id, value) =>
      set(mapSession((session) => driveSessionDimension(session, id, value))),
    setDimensionDriving: (id, driving) =>
      set(mapSession((session) => setSessionDimensionDriving(session, id, driving))),
  };
}

export function viewToggleActions(
  set: SetState,
): Pick<
  DesignStudioState,
  | 'toggleSnap'
  | 'toggleOrtho'
  | 'toggleGrid'
  | 'toggleTracking'
  | 'setPolarStepDeg'
  | 'setActiveTracking'
> {
  return {
    toggleSnap: () =>
      set(mapSession((session) => ({ ...session, snapEnabled: !session.snapEnabled }))),
    toggleOrtho: () =>
      set(mapSession((session) => ({ ...session, orthoEnabled: !session.orthoEnabled }))),
    toggleGrid: () => set(mapSession((session) => ({ ...session, showGrid: !session.showGrid }))),
    toggleTracking: () =>
      set(mapSession((session) => ({ ...session, trackEnabled: !session.trackEnabled }))),
    setPolarStepDeg: (polarStepDeg) =>
      set(mapSession((session) => (polarStepDeg > 0 ? { ...session, polarStepDeg } : session))),
    setActiveTracking: (activeTracking) =>
      set(mapSession((session) => ({ ...session, activeTracking }))),
  };
}

// A closed Studio silently ignores stray actions instead of resurrecting a session.
function mapSession(
  change: (session: DesignSession) => DesignSession,
): (state: DesignStudioState) => Partial<DesignStudioState> {
  return (state) => (state.session === null ? state : { session: change(state.session) });
}
