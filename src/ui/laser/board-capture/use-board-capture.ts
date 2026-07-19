import { useReducer, useRef } from 'react';
import {
  assertNever,
  boardCornersFromOrigin,
  type BoardShapeKind,
  type Vec2,
} from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';

const MIN_CAPTURE_SEPARATION_MM = 1;
export const CIRCLE_RIM_POINT_COUNT = 4;

export type CircleCaptureMethod = 'rim-fit' | 'marked-center';
export type BoardRegistrationEpoch = {
  readonly controllerSessionEpoch: number;
  readonly trustedPositionEpoch: number;
  readonly workOriginVersion: number;
};

export type BoardCaptureState = {
  readonly shapeKind: BoardShapeKind;
  readonly circleMethod: CircleCaptureMethod;
  // Capture-phase samples only. A committed rectangle is canonical BL/BR/TR/TL;
  // a committed circle keeps its resolved center as the sole point.
  readonly corners: ReadonlyArray<Vec2>;
  readonly captureEpoch: BoardRegistrationEpoch | null;
  readonly geometry: CapturedBoardGeometry | null;
  readonly registrationEpoch: BoardRegistrationEpoch | null;
  readonly outlineId: string | null;
  readonly sessionRevision: number;
  readonly committed: boolean;
};

export type BoardCaptureAction =
  | { readonly type: 'set-shape'; readonly shapeKind: BoardShapeKind }
  | { readonly type: 'set-circle-method'; readonly method: CircleCaptureMethod }
  | {
      readonly type: 'capture';
      readonly point: Vec2;
      readonly captureEpoch: BoardRegistrationEpoch;
      readonly expectedSessionRevision: number;
    }
  | { readonly type: 'undo' }
  | {
      readonly type: 'commit';
      readonly geometry: CapturedBoardGeometry;
      readonly registrationEpoch: BoardRegistrationEpoch;
      readonly outlineId: string;
      readonly expectedSessionRevision: number;
    }
  | {
      readonly type: 'update-geometry';
      readonly geometry: CapturedBoardGeometry;
      readonly registrationEpoch: BoardRegistrationEpoch;
    }
  | { readonly type: 'reset' };

export const INITIAL_BOARD_CAPTURE: BoardCaptureState = emptyCaptureState('rect', 'rim-fit');

export function boardCaptureReducer(
  state: BoardCaptureState,
  action: BoardCaptureAction,
): BoardCaptureState {
  switch (action.type) {
    case 'set-shape':
      return changeBoardShape(state, action.shapeKind);
    case 'set-circle-method':
      return changeCircleMethod(state, action.method);
    case 'capture':
      return applyCapture(state, action.point, action.captureEpoch, action.expectedSessionRevision);
    case 'undo':
      return undoCapturePoint(state);
    case 'commit':
      return applyCommit(
        state,
        action.geometry,
        action.registrationEpoch,
        action.outlineId,
        action.expectedSessionRevision,
      );
    case 'update-geometry':
      return applyGeometryUpdate(state, action.geometry, action.registrationEpoch);
    case 'reset':
      return emptyCaptureState('rect', 'rim-fit', state.sessionRevision + 1);
    default:
      return assertNever(action, 'BoardCaptureAction');
  }
}

function undoCapturePoint(state: BoardCaptureState): BoardCaptureState {
  if (state.committed || state.corners.length === 0) return state;
  const corners = state.corners.slice(0, -1);
  return { ...state, corners, captureEpoch: corners.length === 0 ? null : state.captureEpoch };
}

function changeBoardShape(state: BoardCaptureState, shapeKind: BoardShapeKind): BoardCaptureState {
  return state.committed
    ? state
    : emptyCaptureState(shapeKind, state.circleMethod, state.sessionRevision + 1);
}

function changeCircleMethod(
  state: BoardCaptureState,
  method: CircleCaptureMethod,
): BoardCaptureState {
  return state.committed || state.shapeKind !== 'circle'
    ? state
    : emptyCaptureState('circle', method, state.sessionRevision + 1);
}

function emptyCaptureState(
  shapeKind: BoardShapeKind,
  circleMethod: CircleCaptureMethod,
  sessionRevision = 0,
): BoardCaptureState {
  return {
    shapeKind,
    circleMethod,
    corners: [],
    captureEpoch: null,
    geometry: null,
    registrationEpoch: null,
    outlineId: null,
    sessionRevision,
    committed: false,
  };
}

function applyCapture(
  state: BoardCaptureState,
  point: Vec2,
  captureEpoch: BoardRegistrationEpoch,
  expectedSessionRevision: number,
): BoardCaptureState {
  if (state.sessionRevision !== expectedSessionRevision) return state;
  if (state.committed || state.corners.length >= maxCaptures(state)) return state;
  if (state.captureEpoch !== null && !registrationEpochMatches(state.captureEpoch, captureEpoch)) {
    return state;
  }
  if (state.corners.some((sample) => distanceMm(sample, point) < MIN_CAPTURE_SEPARATION_MM)) {
    return state;
  }
  return {
    ...state,
    captureEpoch: state.captureEpoch ?? captureEpoch,
    corners: [...state.corners, point],
  };
}

function maxCaptures(state: BoardCaptureState): number {
  if (state.shapeKind === 'rect') return 4;
  return state.circleMethod === 'rim-fit' ? CIRCLE_RIM_POINT_COUNT : 2;
}

function applyCommit(
  state: BoardCaptureState,
  geometry: CapturedBoardGeometry,
  registrationEpoch: BoardRegistrationEpoch,
  outlineId: string,
  expectedSessionRevision: number,
): BoardCaptureState {
  if (
    state.sessionRevision !== expectedSessionRevision ||
    !boardCaptureCanCommit(state, geometry, registrationEpoch)
  ) {
    return state;
  }
  return {
    ...state,
    geometry,
    registrationEpoch,
    outlineId,
    corners: canonicalPoints(geometry),
    committed: true,
  };
}

export function boardCaptureCanCommit(
  state: BoardCaptureState,
  geometry: CapturedBoardGeometry,
  registrationEpoch: BoardRegistrationEpoch,
): boolean {
  if (state.committed || geometry.kind !== state.shapeKind || !captureCanCommit(state))
    return false;
  if (state.captureEpoch === null) return false;
  const sameMachineFrame =
    state.captureEpoch.controllerSessionEpoch === registrationEpoch.controllerSessionEpoch &&
    state.captureEpoch.trustedPositionEpoch === registrationEpoch.trustedPositionEpoch;
  if (!sameMachineFrame) return false;
  return (
    isRimFitCircle(state) ||
    state.captureEpoch.workOriginVersion === registrationEpoch.workOriginVersion
  );
}

function isRimFitCircle(state: BoardCaptureState): boolean {
  return state.shapeKind === 'circle' && state.circleMethod === 'rim-fit';
}

function captureCanCommit(state: BoardCaptureState): boolean {
  if (state.shapeKind === 'rect') return state.corners.length === 1 || state.corners.length === 4;
  return state.circleMethod === 'rim-fit'
    ? state.corners.length === CIRCLE_RIM_POINT_COUNT
    : state.corners.length >= 1;
}

function applyGeometryUpdate(
  state: BoardCaptureState,
  geometry: CapturedBoardGeometry,
  registrationEpoch: BoardRegistrationEpoch,
): BoardCaptureState {
  if (!state.committed || state.geometry?.kind !== geometry.kind) return state;
  return { ...state, geometry, registrationEpoch, corners: canonicalPoints(geometry) };
}

function canonicalPoints(geometry: CapturedBoardGeometry): ReadonlyArray<Vec2> {
  return geometry.kind === 'rect'
    ? boardCornersFromOrigin(geometry.origin, geometry.widthMm, geometry.heightMm)
    : [geometry.center];
}

export type BoardCapture = {
  readonly state: BoardCaptureState;
  readonly setShape: (shapeKind: BoardShapeKind) => void;
  readonly setCircleMethod: (method: CircleCaptureMethod) => void;
  readonly capture: (point: Vec2, captureEpoch: BoardRegistrationEpoch) => void;
  readonly undo: () => void;
  readonly commit: (
    geometry: CapturedBoardGeometry,
    registrationEpoch: BoardRegistrationEpoch,
    outlineId: string,
  ) => void;
  readonly updateGeometry: (
    geometry: CapturedBoardGeometry,
    registrationEpoch: BoardRegistrationEpoch,
  ) => void;
  readonly isSessionCurrent: () => boolean;
  readonly reset: () => void;
};

export function useBoardCapture(): BoardCapture {
  const [state, dispatch] = useReducer(boardCaptureReducer, INITIAL_BOARD_CAPTURE);
  const sessionToken = useRef(0);
  const renderedSessionToken = sessionToken.current;
  const resetSession = (action: BoardCaptureAction): void => {
    sessionToken.current += 1;
    dispatch(action);
  };
  return {
    state,
    setShape: (shapeKind) => resetSession({ type: 'set-shape', shapeKind }),
    setCircleMethod: (method) => resetSession({ type: 'set-circle-method', method }),
    capture: (point, captureEpoch) =>
      dispatch({
        type: 'capture',
        point,
        captureEpoch,
        expectedSessionRevision: state.sessionRevision,
      }),
    undo: () => dispatch({ type: 'undo' }),
    commit: (geometry, registrationEpoch, outlineId) =>
      dispatch({
        type: 'commit',
        geometry,
        registrationEpoch,
        outlineId,
        expectedSessionRevision: state.sessionRevision,
      }),
    updateGeometry: (geometry, registrationEpoch) =>
      dispatch({ type: 'update-geometry', geometry, registrationEpoch }),
    isSessionCurrent: () => sessionToken.current === renderedSessionToken,
    reset: () => resetSession({ type: 'reset' }),
  };
}

function distanceMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function registrationEpochMatches(
  left: BoardRegistrationEpoch,
  right: BoardRegistrationEpoch,
): boolean {
  return (
    left.controllerSessionEpoch === right.controllerSessionEpoch &&
    left.trustedPositionEpoch === right.trustedPositionEpoch &&
    left.workOriginVersion === right.workOriginVersion
  );
}
