// Pan-drag geometry: classifying a right-button click vs pan, right double-
// click, and turning a pan mouse-move into the next (panX, panY). Split out of
// drag-state.ts to keep that module under the file-size cap. Depends on the
// DragState type only (type-only import — no runtime cycle back into
// drag-state).

import type { Project } from '../../core/scene';
import type { DragState } from './drag-state';
import { computeView } from './view-transform';

const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;
const CONTEXT_CLICK_TOLERANCE_PX = 4;

export function panDragForPointerDown(
  e: { readonly button: number; readonly clientX: number; readonly clientY: number },
  state: {
    readonly spaceDown: boolean;
    readonly panX: number;
    readonly panY: number;
  },
): Extract<DragState, { kind: 'pan' }> | null {
  const trigger = panTriggerForPointerDown(e.button, state.spaceDown);
  if (trigger === null) return null;
  return {
    kind: 'pan',
    trigger,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startPanX: state.panX,
    startPanY: state.panY,
  };
}

export function isStationaryRightPanClick(
  drag: Extract<DragState, { kind: 'pan' }>,
  e: { readonly clientX: number; readonly clientY: number },
): boolean {
  if (drag.trigger !== 'right-button') return false;
  const dx = e.clientX - drag.startClientX;
  const dy = e.clientY - drag.startClientY;
  return Math.hypot(dx, dy) <= CONTEXT_CLICK_TOLERANCE_PX;
}

export function isRightButtonDoubleClick(e: {
  readonly button: number;
  readonly detail: number;
}): boolean {
  return e.button === RIGHT_BUTTON && e.detail >= 2;
}

// Convert a pan-drag mousemove into the next (panX, panY) in scene-mm.
export function panOffsetForDrag(args: {
  readonly drag: Extract<DragState, { kind: 'pan' }>;
  readonly e: { readonly clientX: number; readonly clientY: number };
  readonly canvas: HTMLCanvasElement;
  readonly project: Project;
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
}): { readonly panX: number; readonly panY: number } {
  const rect = args.canvas.getBoundingClientRect();
  const cssScale = rect.width / args.canvas.width;
  const view = computeView(
    args.canvas.width,
    args.canvas.height,
    args.project.device.bedWidth,
    args.project.device.bedHeight,
    args.viewState,
  );
  if (!Number.isFinite(cssScale) || cssScale <= 0) {
    return { panX: args.drag.startPanX, panY: args.drag.startPanY };
  }
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return { panX: args.drag.startPanX, panY: args.drag.startPanY };
  }
  const dxMm = (args.e.clientX - args.drag.startClientX) / cssScale / view.scale;
  const dyMm = (args.e.clientY - args.drag.startClientY) / cssScale / view.scale;
  return { panX: args.drag.startPanX + dxMm, panY: args.drag.startPanY + dyMm };
}

function panTriggerForPointerDown(
  button: number,
  spaceDown: boolean,
): Extract<DragState, { kind: 'pan' }>['trigger'] | null {
  if (spaceDown && button === 0) return 'space-left-button';
  if (button === MIDDLE_BUTTON) return 'middle-button';
  if (button === RIGHT_BUTTON) return 'right-button';
  return null;
}
