import { useReducer, type Dispatch } from 'react';
import type { Vec2 } from '../../../../core/scene';
import { straightenOutlineRun } from './outline-straighten';

export type LoadedImage = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

export type OutlinePhotoSession = {
  readonly image: LoadedImage | null;
  /** The board's outline as the operator clicked it, image pixels, in order around the board. */
  readonly points: ReadonlyArray<Vec2>;
  /** Earlier outlines, newest last, for Undo. */
  readonly history: ReadonlyArray<ReadonlyArray<Vec2>>;
  /** The Straighten edge tool: off, waiting for the first point, or holding it. */
  readonly straighten: null | { readonly from: number | null };
  readonly width: string;
  readonly height: string;
  /** Index into points of the anchor the head captures first; null uses the default. */
  readonly firstAnchor: number | null;
  readonly error: string | null;
};

export type OutlinePhotoAction =
  | { readonly type: 'photo-loaded'; readonly image: LoadedImage }
  | { readonly type: 'point-added'; readonly point: Vec2 }
  | { readonly type: 'drag-started' }
  | { readonly type: 'point-moved'; readonly index: number; readonly point: Vec2 }
  | { readonly type: 'undo' }
  | { readonly type: 'points-cleared' }
  | { readonly type: 'straighten-started' }
  | { readonly type: 'straighten-cancelled' }
  | { readonly type: 'straighten-point-picked'; readonly index: number }
  | { readonly type: 'width-edited'; readonly value: string }
  | { readonly type: 'height-edited'; readonly value: string }
  | { readonly type: 'first-anchor-selected'; readonly index: number }
  | { readonly type: 'error'; readonly error: string | null };

export const MAX_PHOTO_OUTLINE_POINTS = 200;
const MAX_UNDO_STEPS = 100;

export const INITIAL_OUTLINE_PHOTO_SESSION: OutlinePhotoSession = {
  image: null,
  points: [],
  history: [],
  straighten: null,
  width: '',
  height: '',
  firstAnchor: null,
  error: null,
};

export function outlinePhotoSessionReducer(
  state: OutlinePhotoSession,
  action: OutlinePhotoAction,
): OutlinePhotoSession {
  // A new photo has new pixels: points from the old one mean nothing on it.
  if (action.type === 'photo-loaded')
    return { ...INITIAL_OUTLINE_PHOTO_SESSION, image: action.image };
  if (isPointAction(action)) return reducePoints(state, action);
  if (isStraightenAction(action)) return reduceStraighten(state, action);
  return reduceFields(state, action);
}

const POINT_ACTIONS = new Set<OutlinePhotoAction['type']>([
  'point-added',
  'drag-started',
  'point-moved',
  'undo',
  'points-cleared',
]);
const STRAIGHTEN_ACTIONS = new Set<OutlinePhotoAction['type']>([
  'straighten-started',
  'straighten-cancelled',
  'straighten-point-picked',
]);

function isPointAction(action: OutlinePhotoAction): action is PointAction {
  return POINT_ACTIONS.has(action.type);
}

function isStraightenAction(action: OutlinePhotoAction): action is StraightenAction {
  return STRAIGHTEN_ACTIONS.has(action.type);
}

type FieldAction = Extract<
  OutlinePhotoAction,
  { readonly type: 'width-edited' | 'height-edited' | 'first-anchor-selected' | 'error' }
>;

function reduceFields(state: OutlinePhotoSession, action: FieldAction): OutlinePhotoSession {
  switch (action.type) {
    case 'width-edited':
      return { ...state, width: action.value };
    case 'height-edited':
      return { ...state, height: action.value };
    case 'first-anchor-selected':
      return { ...state, firstAnchor: action.index };
    case 'error':
      return { ...state, error: action.error };
  }
}

type PointAction = Extract<
  OutlinePhotoAction,
  { readonly type: 'point-added' | 'drag-started' | 'point-moved' | 'undo' | 'points-cleared' }
>;

function reducePoints(state: OutlinePhotoSession, action: PointAction): OutlinePhotoSession {
  switch (action.type) {
    case 'point-added':
      return state.image === null || state.points.length >= MAX_PHOTO_OUTLINE_POINTS
        ? state
        : withPoints(remembered(state), [...state.points, action.point]);
    case 'drag-started':
      // One Undo puts a dragged point back where the drag began.
      return remembered(state);
    case 'point-moved':
      return state.points[action.index] === undefined
        ? state
        : {
            ...state,
            points: state.points.map((point, index) =>
              index === action.index ? action.point : point,
            ),
          };
    case 'undo': {
      const previous = state.history[state.history.length - 1];
      return previous === undefined
        ? state
        : withPoints({ ...state, history: state.history.slice(0, -1) }, previous);
    }
    case 'points-cleared':
      return state.points.length === 0 ? state : withPoints(remembered(state), []);
  }
}

type StraightenAction = Extract<
  OutlinePhotoAction,
  { readonly type: 'straighten-started' | 'straighten-cancelled' | 'straighten-point-picked' }
>;

function reduceStraighten(
  state: OutlinePhotoSession,
  action: StraightenAction,
): OutlinePhotoSession {
  switch (action.type) {
    case 'straighten-started':
      return state.points.length < 3
        ? state
        : { ...state, straighten: { from: null }, error: null };
    case 'straighten-cancelled':
      return { ...state, straighten: null, error: null };
    case 'straighten-point-picked':
      return pickStraightenPoint(state, action.index);
  }
}

function pickStraightenPoint(state: OutlinePhotoSession, index: number): OutlinePhotoSession {
  const from = state.straighten?.from;
  if (state.straighten === null || state.points[index] === undefined) return state;
  if (from === null || from === undefined || from === index) {
    return { ...state, straighten: { from: index }, error: null };
  }
  const result = straightenOutlineRun(state.points, from, index);
  if (!result.ok) return { ...state, straighten: { from: null }, error: result.reason };
  return { ...withPoints(remembered(state), result.points), straighten: null };
}

function remembered(state: OutlinePhotoSession): OutlinePhotoSession {
  return { ...state, history: [...state.history, state.points].slice(-MAX_UNDO_STEPS) };
}

function withPoints(state: OutlinePhotoSession, points: ReadonlyArray<Vec2>): OutlinePhotoSession {
  const firstAnchor =
    state.firstAnchor !== null && state.firstAnchor < points.length ? state.firstAnchor : null;
  const straighten = points.length < 3 ? null : state.straighten;
  return { ...state, points, firstAnchor, straighten, error: null };
}

export type OutlinePhotoDispatch = Dispatch<OutlinePhotoAction>;

export function useOutlinePhotoSession(): readonly [OutlinePhotoSession, OutlinePhotoDispatch] {
  return useReducer(outlinePhotoSessionReducer, INITIAL_OUTLINE_PHOTO_SESSION);
}
