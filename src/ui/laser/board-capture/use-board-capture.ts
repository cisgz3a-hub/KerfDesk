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
  | { readonly type: 'reset' };

export const INITIAL_BOARD_CAPTURE: BoardCaptureState = { corners: [], committed: false };

export function boardCaptureReducer(
  state: BoardCaptureState,
  action: BoardCaptureAction,
): BoardCaptureState {
  switch (action.type) {
    case 'capture': {
      if (state.committed || state.corners.length >= BOARD_CORNER_COUNT) return state;
      // Reject a re-capture at (essentially) the previous corner — the
      // signature of a double-click, which would corrupt the rectangle.
      const last = state.corners[state.corners.length - 1];
      if (last !== undefined && distanceMm(last, action.point) < MIN_CORNER_SEPARATION_MM) {
        return state;
      }
      return { ...state, corners: [...state.corners, action.point] };
    }
    case 'undo':
      if (state.committed || state.corners.length === 0) return state;
      return { ...state, corners: state.corners.slice(0, -1) };
    case 'commit':
      if (state.corners.length !== BOARD_CORNER_COUNT) return state;
      return { ...state, committed: true };
    case 'reset':
      return INITIAL_BOARD_CAPTURE;
    default:
      return assertNever(action, 'BoardCaptureAction');
  }
}

export type BoardCapture = {
  readonly state: BoardCaptureState;
  readonly capture: (point: Vec2) => void;
  readonly undo: () => void;
  readonly commit: () => void;
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
    reset: () => dispatch({ type: 'reset' }),
  };
}
