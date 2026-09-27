// Keyboard for the 3D view (ADR-470). With the view focused (click it, or tab
// to it): Space plays and pauses, the arrows step one move, Home and End go to
// the start and end, F fits the job, 1 to 4 pick Iso, Top, Front and Right,
// O switches orthographic, M measures and Esc clears a measurement. Keys the
// view does not use, and keys typed into its fields, pass through untouched.

import { useEffect, useRef, type RefObject } from 'react';
import { CAMERA_PRESETS, type CameraPreset } from '../viewer3d';

export type ViewportKeyAction =
  | { readonly kind: 'play' }
  | { readonly kind: 'step'; readonly direction: 1 | -1 }
  | { readonly kind: 'start' }
  | { readonly kind: 'end' }
  | { readonly kind: 'fit' }
  | { readonly kind: 'view'; readonly view: CameraPreset }
  | { readonly kind: 'ortho' }
  | { readonly kind: 'measure' }
  | { readonly kind: 'escape' };

/** The shortcuts in words, for the view's hint while it has focus. */
export const VIEWPORT_KEYS_HINT =
  'Space play · ←/→ one move · Home/End · F fit · 1-4 views · O ortho · M measure';

const FIXED_KEYS: Readonly<Record<string, ViewportKeyAction>> = {
  ' ': { kind: 'play' },
  ArrowLeft: { kind: 'step', direction: -1 },
  ArrowRight: { kind: 'step', direction: 1 },
  Home: { kind: 'start' },
  End: { kind: 'end' },
  f: { kind: 'fit' },
  o: { kind: 'ortho' },
  m: { kind: 'measure' },
  Escape: { kind: 'escape' },
};

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>;

export function viewportKeyAction(event: KeyEventLike): ViewportKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const view = CAMERA_PRESETS[Number(key) - 1];
  if (/^[1-9]$/.test(key)) return view === undefined ? null : { kind: 'view', view };
  return FIXED_KEYS[key] ?? null;
}

/** Runs an action; false leaves the key to the rest of the page. */
export type ViewportKeyHandler = (action: ViewportKeyAction) => boolean;

/**
 * Listens on the view's own element, ahead of the dialog around it, so an Esc
 * the view uses does not also close the dialog.
 */
export function useViewportKeys(
  elementRef: RefObject<HTMLElement | null>,
  handle: ViewportKeyHandler,
): void {
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || typingInto(event.target, event.key)) return;
      const action = viewportKeyAction(event);
      if (action === null || !handleRef.current(action)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [elementRef]);
}

// Fields keep their own keys, and a focused button keeps Space.
function typingInto(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return tag === 'BUTTON' && (key === ' ' || key === 'Enter');
}

/** Playback moves the keys reach; absent in live mode, where the machine leads. */
export type ViewportTransport = {
  readonly togglePlay: () => void;
  readonly stepMove: (direction: 1 | -1) => void;
  readonly toStart: () => void;
  readonly toEnd: () => void;
};

export type ViewportKeyTargets = {
  readonly ready: boolean;
  readonly transport: ViewportTransport | undefined;
  readonly selectView: (view: CameraPreset) => void;
  readonly fit: () => void;
  readonly toggleProjection: () => void;
  /** Null where the view has nothing to measure. */
  readonly measure: {
    readonly active: boolean;
    readonly from: unknown;
    readonly toggle: () => void;
    readonly clear: () => void;
  } | null;
};

type Runner<K extends ViewportKeyAction['kind']> = (
  targets: ViewportKeyTargets,
  action: Extract<ViewportKeyAction, { kind: K }>,
) => boolean;

const RUNNERS: { readonly [K in ViewportKeyAction['kind']]: Runner<K> } = {
  play: (targets) => run(targets.transport?.togglePlay),
  step: (targets, action) =>
    run(targets.transport && (() => targets.transport?.stepMove(action.direction))),
  start: (targets) => run(targets.transport?.toStart),
  end: (targets) => run(targets.transport?.toEnd),
  fit: (targets) => targets.ready && run(targets.fit),
  view: (targets, action) => targets.ready && run(() => targets.selectView(action.view)),
  ortho: (targets) => targets.ready && run(targets.toggleProjection),
  measure: (targets) => targets.ready && run(targets.measure?.toggle),
  // Esc first drops the points, then the tool; with neither it closes the dialog.
  escape: (targets) => {
    const measure = targets.measure;
    if (measure === null || !measure.active) return false;
    if (measure.from === null) measure.toggle();
    else measure.clear();
    return true;
  },
};

export function runViewportKey(targets: ViewportKeyTargets, action: ViewportKeyAction): boolean {
  const runner = RUNNERS[action.kind] as Runner<typeof action.kind>;
  return runner(targets, action as never);
}

function run(action: (() => void) | undefined): boolean {
  if (action === undefined) return false;
  action();
  return true;
}
