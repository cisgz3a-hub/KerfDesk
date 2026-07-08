// use-board-capture — the ephemeral capture-in-progress state (ADR-124): the
// machine coordinates recorded so far and whether the board has been committed
// to the scene. A pure reducer (mirrors the ADR-092 device-setup wizard) so the
// transition logic is testable without React.

import { useReducer } from 'react';
import { assertNever, BOARD_CORNER_COUNT, type Vec2 } from '../../../core/scene';

// Two captures closer than this are treated as the same corner. A double-click
// records the identical (stationary-head) machine position twice, which would
// otherwise inject a zero-length edge and silently corrupt the best-fit
// rectangle; real board corners are centimetres apart.
const MIN_CORNER_SEPARATION_MM = 1;

export type BoardCaptureState = {
  readonly corners: ReadonlyArray<Vec2>;
  readonly committed: boolean;
};

export type BoardCaptureAction =
  | { readonly type: 'capture'; readonly point: Vec2 }
  | { readonly type: 'undo' }
  | { readonly type: 'commit' }
  // Manual-size path: replace the (single captured) corner set with the four
  // corners synthesized from the origin + typed size, and commit in one step.
  | { readonly type: 'commit-manual'; readonly corners: ReadonlyArray<Vec2> }
  | { readonly type: 'reset' };

export const INITIAL_BOARD_CAPTURE: BoardCaptureState = { corners: [], committed: false };

export function boardCaptureReducer(
  state: BoardCaptureState,
  action: BoardCaptureAction,
): BoardCaptureState {
  switch (action.type) {
    case 'capture':
      return applyCapture(state, action.point);
    case 'undo':
      return applyUndo(state);
    case 'commit':
      return state.corners.length === BOARD_CORNER_COUNT ? { ...state, committed: true } : state;
    case 'commit-manual':
      return applyCommitManual(state, action.corners);
    case 'reset':
      return INITIAL_BOARD_CAPTURE;
    default:
      return assertNever(action, 'BoardCaptureAction');
  }
}

function applyCapture(state: BoardCaptureState, point: Vec2): BoardCaptureState {
  if (state.committed || state.corners.length >= BOARD_CORNER_COUNT) return state;
  // Reject a re-capture at (essentially) the previous corner — the signature of
  // a double-click, which would corrupt the rectangle.
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
  return { corners, committed: true };
}

export type BoardCapture = {
  readonly state: BoardCaptureState;
  readonly capture: (point: Vec2) => void;
  readonly undo: () => void;
  readonly commit: () => void;
  readonly commitManual: (corners: ReadonlyArray<Vec2>) => void;
  readonly reset: () => void;
};

function distanceMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function useBoardCapture(): BoardCapture {
  const [state, dispatch] = useReducer(boardCaptureReducer, INITIAL_BOARD_CAPTURE);
  return {
    state,
    capture: (point) => dispatch({ type: 'capture', point }),
    undo: () => dispatch({ type: 'undo' }),
    commit: () => dispatch({ type: 'commit' }),
    commitManual: (corners) => dispatch({ type: 'commit-manual', corners }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
