// Pure pointer-drag state for the Image Studio canvas (ADR-242).
//
// Mirrors the workspace's drag-state approach: a discriminated union the
// pointer hook advances, with all completion side effects (store commits)
// dispatched by the caller on pointer-up. Coordinates are document pixels.

import type { PaintPoint } from '../../core/image-edit';
import type { EditorTool } from './editor-session';

export type EditorDrag =
  | { readonly kind: 'idle' }
  | { readonly kind: 'paint'; readonly points: readonly PaintPoint[] }
  | {
      readonly kind: 'line';
      readonly from: PaintPoint;
      readonly to: PaintPoint;
      readonly shift: boolean;
    }
  | {
      readonly kind: 'marquee';
      readonly from: PaintPoint;
      readonly to: PaintPoint;
      readonly ellipse: boolean;
    }
  | { readonly kind: 'lasso'; readonly points: readonly PaintPoint[] }
  | { readonly kind: 'move-selection'; readonly from: PaintPoint; readonly to: PaintPoint }
  | { readonly kind: 'pan'; readonly lastClientX: number; readonly lastClientY: number };

export const IDLE_DRAG: EditorDrag = { kind: 'idle' };

// Minimum drag distance (document px) below which a marquee counts as a
// click and clears the selection instead of selecting a sliver.
export const CLICK_TOLERANCE_PX = 2;

export function beginDrag(
  tool: EditorTool,
  point: PaintPoint,
  shift: boolean,
  hasSelection: boolean,
): EditorDrag {
  switch (tool.kind) {
    case 'brush':
    case 'pencil':
    case 'eraser':
      return { kind: 'paint', points: [point] };
    case 'line':
      return { kind: 'line', from: point, to: point, shift };
    case 'marquee':
      return { kind: 'marquee', from: point, to: point, ellipse: shift };
    case 'lasso':
      return { kind: 'lasso', points: [point] };
    case 'wand':
      // Wand is a click tool; the hook commits immediately on down.
      return IDLE_DRAG;
    case 'move':
      return hasSelection ? { kind: 'move-selection', from: point, to: point } : IDLE_DRAG;
  }
}

export function advanceDrag(drag: EditorDrag, point: PaintPoint, shift: boolean): EditorDrag {
  switch (drag.kind) {
    case 'idle':
    case 'pan':
      return drag;
    case 'paint':
      return { kind: 'paint', points: [...drag.points, point] };
    case 'line':
      return { ...drag, to: point, shift };
    case 'marquee':
      return { ...drag, to: point, ellipse: shift };
    case 'lasso':
      return { kind: 'lasso', points: [...drag.points, point] };
    case 'move-selection':
      return { ...drag, to: point };
  }
}

export function marqueeRect(drag: Extract<EditorDrag, { kind: 'marquee' }>): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const x = Math.min(drag.from.x, drag.to.x);
  const y = Math.min(drag.from.y, drag.to.y);
  return {
    x,
    y,
    width: Math.abs(drag.to.x - drag.from.x),
    height: Math.abs(drag.to.y - drag.from.y),
  };
}
