import { useReducer, type Dispatch } from 'react';
import { defaultCaptureOrder, type Vec2 } from '../../../../core/scene';
import type { LoadedImage, ReferenceKind, TraceState } from './outline-photo-rectify';

export type OutlinePhotoSession = {
  readonly image: LoadedImage | null;
  readonly corners: ReadonlyArray<Vec2>;
  readonly reference: ReferenceKind;
  readonly customWidth: string;
  readonly customHeight: string;
  readonly trace: TraceState | null;
  readonly outline: ReadonlyArray<Vec2> | null;
  readonly anchors: ReadonlyArray<number>;
  readonly firstAnchor: number;
  readonly width: string;
  readonly height: string;
  readonly partial: boolean;
  readonly busy: boolean;
  readonly busyLabel: string;
  readonly error: string | null;
  readonly anchorHint: string | null;
};

export type OutlinePhotoAction =
  | { readonly type: 'photo-loaded'; readonly image: LoadedImage }
  | { readonly type: 'reference-changed'; readonly reference: ReferenceKind }
  | {
      readonly type: 'custom-size-changed';
      readonly axis: 'width' | 'height';
      readonly value: string;
    }
  | { readonly type: 'clear-corners' }
  | { readonly type: 'corner-added'; readonly point: Vec2 }
  | { readonly type: 'busy-start'; readonly label: string }
  | { readonly type: 'busy-end' }
  | { readonly type: 'error'; readonly error: string | null }
  | { readonly type: 'trace-ready'; readonly trace: TraceState }
  | { readonly type: 'retap-board' }
  | {
      readonly type: 'traced';
      readonly outline: ReadonlyArray<Vec2>;
      readonly anchors: ReadonlyArray<number>;
      readonly firstAnchor: number;
      readonly width: string;
      readonly height: string;
      readonly partial: boolean;
    }
  | { readonly type: 'width-edited'; readonly value: string }
  | { readonly type: 'height-edited'; readonly value: string }
  | { readonly type: 'first-anchor-selected'; readonly index: number }
  | { readonly type: 'anchors-changed'; readonly anchors: ReadonlyArray<number> }
  | { readonly type: 'anchor-hint'; readonly hint: string | null };

const RESET_TRACE: Pick<
  OutlinePhotoSession,
  'trace' | 'outline' | 'anchors' | 'firstAnchor' | 'width' | 'height' | 'partial'
> = {
  trace: null,
  outline: null,
  anchors: [],
  firstAnchor: 0,
  width: '',
  height: '',
  partial: false,
};

export const INITIAL_OUTLINE_PHOTO_SESSION: OutlinePhotoSession = {
  image: null,
  corners: [],
  reference: 'a4',
  customWidth: '210',
  customHeight: '297',
  ...RESET_TRACE,
  busy: false,
  busyLabel: '',
  error: null,
  anchorHint: null,
};

export function outlinePhotoSessionReducer(
  state: OutlinePhotoSession,
  action: OutlinePhotoAction,
): OutlinePhotoSession {
  if (isResetAction(action)) return reduceResetAction(state, action);
  if (isRuntimeAction(action)) return reduceRuntimeAction(state, action);
  return reduceEditAction(state, action);
}

type ResetAction = Extract<
  OutlinePhotoAction,
  {
    readonly type:
      | 'photo-loaded'
      | 'reference-changed'
      | 'custom-size-changed'
      | 'clear-corners'
      | 'corner-added';
  }
>;
type RuntimeAction = Extract<
  OutlinePhotoAction,
  {
    readonly type: 'busy-start' | 'busy-end' | 'error' | 'trace-ready' | 'retap-board';
  }
>;
type EditAction = Exclude<OutlinePhotoAction, ResetAction | RuntimeAction>;

const RESET_ACTIONS = new Set<OutlinePhotoAction['type']>([
  'photo-loaded',
  'reference-changed',
  'custom-size-changed',
  'clear-corners',
  'corner-added',
]);
const RUNTIME_ACTIONS = new Set<OutlinePhotoAction['type']>([
  'busy-start',
  'busy-end',
  'error',
  'trace-ready',
  'retap-board',
]);

function isResetAction(action: OutlinePhotoAction): action is ResetAction {
  return RESET_ACTIONS.has(action.type);
}

function isRuntimeAction(action: OutlinePhotoAction): action is RuntimeAction {
  return RUNTIME_ACTIONS.has(action.type);
}

function reduceResetAction(state: OutlinePhotoSession, action: ResetAction): OutlinePhotoSession {
  switch (action.type) {
    case 'photo-loaded':
      return resetForPhoto(state, action.image);
    case 'reference-changed':
      return resetTrace({ ...state, reference: action.reference });
    case 'custom-size-changed':
      return resetTrace({
        ...state,
        [action.axis === 'width' ? 'customWidth' : 'customHeight']: action.value,
      });
    case 'clear-corners':
      return { ...resetTrace(state), corners: [] };
    case 'corner-added':
      return state.corners.length >= 4
        ? state
        : { ...state, corners: [...state.corners, action.point] };
  }
}

function reduceRuntimeAction(
  state: OutlinePhotoSession,
  action: RuntimeAction,
): OutlinePhotoSession {
  switch (action.type) {
    case 'busy-start':
      return { ...state, busy: true, busyLabel: action.label, error: null };
    case 'busy-end':
      return { ...state, busy: false, busyLabel: '' };
    case 'error':
      return { ...state, error: action.error };
    case 'trace-ready':
      return { ...resetOutline(state), trace: action.trace };
    case 'retap-board':
      return resetOutline(state);
  }
}

function reduceEditAction(state: OutlinePhotoSession, action: EditAction): OutlinePhotoSession {
  switch (action.type) {
    case 'traced':
      return tracedState(state, action);
    case 'width-edited':
      return { ...state, width: action.value };
    case 'height-edited':
      return { ...state, height: action.value };
    case 'first-anchor-selected':
      return { ...state, firstAnchor: action.index };
    case 'anchors-changed':
      return anchorsChanged(state, action.anchors);
    case 'anchor-hint':
      return { ...state, anchorHint: action.hint };
  }
}

function tracedState(
  state: OutlinePhotoSession,
  action: Extract<OutlinePhotoAction, { readonly type: 'traced' }>,
): OutlinePhotoSession {
  return {
    ...state,
    outline: action.outline,
    anchors: action.anchors,
    firstAnchor: action.firstAnchor,
    width: action.width,
    height: action.height,
    partial: action.partial,
    error: null,
    anchorHint: null,
  };
}

function resetForPhoto(state: OutlinePhotoSession, image: LoadedImage): OutlinePhotoSession {
  return {
    ...INITIAL_OUTLINE_PHOTO_SESSION,
    reference: state.reference,
    customWidth: state.customWidth,
    customHeight: state.customHeight,
    image,
  };
}

function resetTrace(state: OutlinePhotoSession): OutlinePhotoSession {
  return { ...state, ...RESET_TRACE, error: null, anchorHint: null };
}

function resetOutline(state: OutlinePhotoSession): OutlinePhotoSession {
  return {
    ...state,
    outline: null,
    anchors: [],
    firstAnchor: 0,
    width: '',
    height: '',
    partial: false,
    error: null,
    anchorHint: null,
  };
}

function anchorsChanged(
  state: OutlinePhotoSession,
  anchors: ReadonlyArray<number>,
): OutlinePhotoSession {
  const order = state.outline === null ? null : defaultCaptureOrder(state.outline, anchors);
  const firstAnchor = anchors.includes(state.firstAnchor)
    ? state.firstAnchor
    : (order?.[0] ?? anchors[0] ?? 0);
  return { ...state, anchors, firstAnchor };
}

export type OutlinePhotoDispatch = Dispatch<OutlinePhotoAction>;

export function useOutlinePhotoSession(): readonly [OutlinePhotoSession, OutlinePhotoDispatch] {
  return useReducer(outlinePhotoSessionReducer, INITIAL_OUTLINE_PHOTO_SESSION);
}
