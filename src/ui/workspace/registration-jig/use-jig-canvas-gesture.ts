import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { hitTest, type Project, type Vec2 } from '../../../core/scene';
import type { HandleKind } from '../handles';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from '../view-transform';
import type { JigMarquee } from './jig-canvas-paint';
import {
  jigEditableSelection,
  jigHandleAt,
  jigSelectionForHit,
  jigSelectionInMarquee,
  moveJigSelection,
  resizeJigSelection,
  rotateJigSelection,
  type JigHandle,
} from './jig-canvas-selection';

export type JigGesture = {
  readonly pointerId: number;
  readonly kind: 'move' | 'pan' | 'resize' | 'rotate' | 'marquee';
  readonly start: Vec2;
  readonly base: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly view: ViewState;
  readonly handle?: HandleKind;
};

export type JigGestureArgs = {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onCommit: (project: Project) => void;
  readonly ref: RefObject<HTMLCanvasElement>;
  readonly view: ViewState;
  readonly setView: (view: ViewState) => void;
  readonly setPreview: Dispatch<SetStateAction<Project | null>>;
  readonly spaceHeld: MutableRefObject<boolean>;
};

type GestureContext = JigGestureArgs & {
  readonly gesture: MutableRefObject<JigGesture | null>;
  readonly setMarquee: Dispatch<SetStateAction<JigMarquee | null>>;
  readonly setNotice: Dispatch<SetStateAction<string>>;
};

export const OBLIQUE_STRETCH_NOTICE =
  'Artwork turned at an angle can only be resized evenly: drag a corner handle without Shift.';

// A press that travels less than this is a click, not a box selection.
const MARQUEE_MIN_PX = 3;

const HANDLE_CURSORS: Readonly<Record<HandleKind, string>> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Pointer gestures on the jig canvas. Every edit previews locally and
 * commits once on release; a cancelled gesture commits nothing. */
export function useJigCanvasGesture(args: JigGestureArgs) {
  const { project, setPreview } = args;
  const gesture = useRef<JigGesture | null>(null);
  const [marquee, setMarquee] = useState<JigMarquee | null>(null);
  const [notice, setNotice] = useState('');
  const cancel = (): void => {
    gesture.current = null;
    setPreview(null);
    setMarquee(null);
  };
  useEffect(() => {
    gesture.current = null;
    setPreview(null);
    setMarquee(null);
  }, [project, setPreview]);
  const context: GestureContext = { ...args, gesture, setMarquee, setNotice };
  return {
    gesture,
    marquee,
    notice,
    cancel,
    begin: (event: PointerEvent<HTMLCanvasElement>) => beginJigGesture(context, event),
    update: (event: PointerEvent<HTMLCanvasElement>) => {
      updateJigGesture(context, event);
    },
    end: (event: PointerEvent<HTMLCanvasElement>, cancelled: boolean) =>
      endJigGesture(context, event, cancelled),
  };
}

function beginJigGesture(context: GestureContext, event: PointerEvent<HTMLCanvasElement>): void {
  const { project, view, ref } = context;
  if (event.button !== 0 && event.button !== 1) return;
  const point = canvasMouseToScene(event, ref.current, project, view);
  if (point === null) return;
  event.preventDefault();
  event.currentTarget.focus();
  context.setNotice('');
  const pan = event.button === 1 || context.spaceHeld.current;
  const started = { pointerId: event.pointerId, start: point, base: project, view };
  const next = pan
    ? { ...started, kind: 'pan' as const, selectedIds: context.selectedIds }
    : pickJigGesture(context, point, event.shiftKey);
  if (next === null) return;
  context.gesture.current = { ...started, ...next };
  event.currentTarget.setPointerCapture(event.pointerId);
}

// A handle of the selection wins; otherwise the press selects what it hit
// (whole groups) and drags it, or starts a box selection on empty canvas.
function pickJigGesture(
  context: GestureContext,
  point: Vec2,
  additive: boolean,
): Pick<JigGesture, 'kind' | 'selectedIds' | 'handle'> | null {
  const { project, selectedIds } = context;
  const pxToMm = pxToMmForCanvas(context.ref.current, project, context.view);
  const handle = jigHandleAt(jigEditableSelection(project, selectedIds), point, pxToMm);
  if (handle !== null) return { ...handle, selectedIds };
  const hit = hitTest(project.scene, point);
  const nextIds = selectionAtHit(project, hit, selectedIds, additive);
  context.onSelectionChange(nextIds);
  if (hit === null) return { kind: 'marquee', selectedIds: nextIds };
  return nextIds.has(hit) ? { kind: 'move', selectedIds: nextIds } : null;
}

function selectionAtHit(
  project: Project,
  hit: string | null,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
): ReadonlySet<string> {
  if (hit === null) return additive ? selectedIds : new Set<string>();
  return jigSelectionForHit(project.scene, hit, selectedIds, additive);
}

function updateJigGesture(
  context: GestureContext,
  event: PointerEvent<HTMLCanvasElement>,
): Project | null {
  const active = context.gesture.current;
  if (active === null) {
    showHoverCursor(context, event);
    return null;
  }
  if (active.pointerId !== event.pointerId || active.base !== context.project) return null;
  const point = canvasMouseToScene(event, context.ref.current, context.project, active.view);
  if (point === null) return null;
  if (active.kind === 'pan') {
    const { view, start } = active;
    context.setView({
      ...view,
      panX: view.panX + point.x - start.x,
      panY: view.panY + point.y - start.y,
    });
    return null;
  }
  if (active.kind === 'marquee') {
    context.setMarquee({ start: active.start, end: point });
    return null;
  }
  const edit = jigGestureEdit(active, point, event.shiftKey);
  context.setNotice(edit.refused ? OBLIQUE_STRETCH_NOTICE : '');
  context.setPreview(edit.project);
  return edit.project;
}

function jigGestureEdit(
  active: JigGesture,
  point: Vec2,
  shiftKey: boolean,
): { readonly project: Project; readonly refused: boolean } {
  const { base, selectedIds, start } = active;
  if (active.kind === 'resize' && active.handle !== undefined) {
    return resizeJigSelection(base, selectedIds, {
      handle: active.handle,
      start,
      point,
      lockAspect: !shiftKey,
    });
  }
  if (active.kind === 'rotate') {
    return {
      project: rotateJigSelection(base, selectedIds, { start, point, snap: shiftKey }),
      refused: false,
    };
  }
  return {
    project: moveJigSelection(base, selectedIds, point.x - start.x, point.y - start.y),
    refused: false,
  };
}

function endJigGesture(
  context: GestureContext,
  event: PointerEvent<HTMLCanvasElement>,
  cancelled: boolean,
): void {
  const active = context.gesture.current;
  if (active === null || active.pointerId !== event.pointerId) return;
  const next = cancelled ? null : updateJigGesture(context, event);
  const selection = cancelled ? null : marqueeSelection(context, active, event);
  context.gesture.current = null;
  context.setPreview(null);
  context.setMarquee(null);
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (selection !== null) context.onSelectionChange(selection);
  if (next !== null && next !== active.base) context.onCommit(next);
}

function marqueeSelection(
  context: GestureContext,
  active: JigGesture,
  event: PointerEvent<HTMLCanvasElement>,
): ReadonlySet<string> | null {
  const { project, ref } = context;
  if (active.kind !== 'marquee' || active.base !== project) return null;
  const end = canvasMouseToScene(event, ref.current, project, active.view);
  if (end === null) return null;
  const minMm = MARQUEE_MIN_PX * pxToMmForCanvas(ref.current, project, active.view);
  if (Math.abs(end.x - active.start.x) < minMm && Math.abs(end.y - active.start.y) < minMm)
    return null;
  return jigSelectionInMarquee(project.scene, active.start, end, active.selectedIds);
}

function showHoverCursor(context: GestureContext, event: PointerEvent<HTMLCanvasElement>): void {
  const { project, selectedIds, view, ref } = context;
  const point = canvasMouseToScene(event, ref.current, project, view);
  const handle =
    point === null
      ? null
      : jigHandleAt(
          jigEditableSelection(project, selectedIds),
          point,
          pxToMmForCanvas(ref.current, project, view),
        );
  event.currentTarget.style.cursor = handleCursor(handle);
}

function handleCursor(handle: JigHandle | null): string {
  if (handle === null) return '';
  return handle.kind === 'rotate' ? 'grab' : HANDLE_CURSORS[handle.handle];
}
