// use-board-capture — the ephemeral capture-in-progress state (ADR-124,
// generalized to board shapes in ADR-126): the machine coordinates recorded so
// far, the shape being captured, and whether the board has been committed to the
// scene. A pure reducer (mirrors the ADR-092 device-setup wizard) so the
// transition logic is testable without React.
//
// `corners` is shape-relative: for a rectangle it is up to four corner points
// (index 0 = the bottom-left origin); for a circle it is [centre] or
// [centre, rim] (index 0 = the centre origin, index 1 = an optional rim point
// used only to measure the diameter).

import { useReducer } from 'react';
import {
  assertNever,
  BOARD_CORNER_COUNT,
  type BoardShape,
  type BoardShapeKind,
  type Vec2,
} from '../../../core/scene';

// Two captures closer than this are treated as the same point. A double-click
// records the identical (stationary-head) machine position twice, which would
// otherwise inject a zero-length edge; real corners / rim points are far apart.
const MIN_CORNER_SEPARATION_MM = 1;

// A circle captures at most the centre + one rim point.
const MAX_CIRCLE_CAPTURES = 2;

export type BoardCaptureState = {
  readonly shapeKind: BoardShapeKind;
  readonly corners: ReadonlyArray<Vec2>;
  // The resolved shape, set at commit — a circle records its diameter here; a
  // rectangle derives its size from `corners`, so it stays null.
  readonly shape: BoardShape | null;
  readonly committed: boolean;
};

export type BoardCaptureAction =
  | { readonly type: 'set-shape'; readonly shapeKind: BoardShapeKind }
  | { readonly type: 'capture'; readonly point: Vec2 }
  | { readonly type: 'undo' }
  | { readonly type: 'commit' }
  // Manual-size path (rect): replace the (single captured) corner set with the
  // four synthesized corners and commit in one step.
  | { readonly type: 'commit-manual'; readonly corners: ReadonlyArray<Vec2> }
  // Circle: commit the captured centre + a diameter (typed, or measured from a
  // rim capture — the caller resolves the value).
  | { readonly type: 'commit-circle'; readonly diameterMm: number }
  | { readonly type: 'reset' };

export const INITIAL_BOARD_CAPTURE: BoardCaptureState = {
  shapeKind: 'rect',
  corners: [],
  shape: null,
  committed: false,
};

export function boardCaptureReducer(
  state: BoardCaptureState,
  action: BoardCaptureAction,
): BoardCaptureState {
  switch (action.type) {
    case 'set-shape':
      // Switching shape mid-capture clears the in-progress points; no-op once
      // committed (the operator resets / captures a new board instead).
      return state.committed
        ? state
        : { shapeKind: action.shapeKind, corners: [], shape: null, committed: false };
    case 'capture':
      return applyCapture(state, action.point);
    case 'undo':
      return applyUndo(state);
    case 'commit':
      return state.corners.length === BOARD_CORNER_COUNT ? { ...state, committed: true } : state;
    case 'commit-manual':
      return applyCommitManual(state, action.corners);
    case 'commit-circle':
      return applyCommitCircle(state, action.diameterMm);
    case 'reset':
      return INITIAL_BOARD_CAPTURE;
    default:
      return assertNever(action, 'BoardCaptureAction');
  }
}

function maxCaptures(shapeKind: BoardShapeKind): number {
  return shapeKind === 'circle' ? MAX_CIRCLE_CAPTURES : BOARD_CORNER_COUNT;
}

function applyCapture(state: BoardCaptureState, point: Vec2): BoardCaptureState {
  if (state.committed || state.corners.length >= maxCaptures(state.shapeKind)) return state;
  // Reject a re-capture at (essentially) the previous point — a double-click, or
  // a circle rim point landing on the centre.
  const last = state.corners[state.corners.length - 1];
  if (last !== undefined && distanceMm(last, point) < MIN_CORNER_SEPARATION_MM) return state;
  return { ...state, corners: [...state.corners, point] };
}

function applyUndo(state: BoardCaptureState): BoardCaptureState {
  if (state.committed || state.corners.length === 0) return state;
  return { ...state, corners: state.corners.slice(0, -1) };
}

function applyCommitManual(
  state: BoardCaptureState,
  corners: ReadonlyArray<Vec2>,
): BoardCaptureState {
  if (state.committed || corners.length !== BOARD_CORNER_COUNT) return state;
  return { ...state, corners, committed: true };
}

function applyCommitCircle(state: BoardCaptureState, diameterMm: number): BoardCaptureState {
  // Needs the centre captured (index 0); the rim point is optional.
  if (state.committed || state.shapeKind !== 'circle' || state.corners.length === 0) return state;
  return { ...state, shape: { kind: 'circle', diameterMm }, committed: true };
}

export type BoardCapture = {
  readonly state: BoardCaptureState;
  readonly setShape: (shapeKind: BoardShapeKind) => void;
  readonly capture: (point: Vec2) => void;
  readonly undo: () => void;
  readonly commit: () => void;
  readonly commitManual: (corners: ReadonlyArray<Vec2>) => void;
  readonly commitCircle: (diameterMm: number) => void;
  readonly reset: () => void;
};

function distanceMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function useBoardCapture(): BoardCapture {
  const [state, dispatch] = useReducer(boardCaptureReducer, INITIAL_BOARD_CAPTURE);
  return {
    state,
    setShape: (shapeKind) => dispatch({ type: 'set-shape', shapeKind }),
    capture: (point) => dispatch({ type: 'capture', point }),
    undo: () => dispatch({ type: 'undo' }),
    commit: () => dispatch({ type: 'commit' }),
    commitManual: (corners) => dispatch({ type: 'commit-manual', corners }),
    commitCircle: (diameterMm) => dispatch({ type: 'commit-circle', diameterMm }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
