// Pure pointer-drag state for the Image Studio canvas (ADR-242, PP-B).
//
// Photoshop modifier grammar: with an existing selection, Shift/Alt at
// pointer-down pick the boolean mode (add / subtract / both = intersect);
// without one, Shift constrains square/circle and Alt draws from the centre,
// live during the drag. Spacebar mid-drag repositions the in-progress
// marquee. Starting inside the existing selection moves the outline (or the
// pixels with Ctrl). Completion side effects are dispatched by the pointer
// hook on pointer-up.

import type { PaintPoint, PixelRect } from '../../core/image-edit';
import type { SelectionCombineMode } from '../../core/image-select';
import type { EditorTool } from './editor-session';

export type DragModifiers = {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
};

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
      readonly shape: 'rect' | 'ellipse';
      readonly constrain: boolean;
      readonly fromCenter: boolean;
      readonly booleanOverride: SelectionCombineMode | null;
    }
  | {
      readonly kind: 'lasso';
      readonly points: readonly PaintPoint[];
      readonly booleanOverride: SelectionCombineMode | null;
    }
  | { readonly kind: 'crop-drag'; readonly from: PaintPoint; readonly to: PaintPoint }
  | { readonly kind: 'move-outline'; readonly from: PaintPoint; readonly to: PaintPoint }
  | { readonly kind: 'move-selection'; readonly from: PaintPoint; readonly to: PaintPoint }
  | { readonly kind: 'pan'; readonly lastClientX: number; readonly lastClientY: number };

export const IDLE_DRAG: EditorDrag = { kind: 'idle' };

// Minimum drag distance (document px) below which a marquee counts as a
// click (replace-mode click clears the selection).
export const CLICK_TOLERANCE_PX = 2;

/** Shift/Alt at pointer-down → transient boolean mode (Photoshop). */
export function booleanFromModifiers(
  modifiers: DragModifiers,
  hasSelection: boolean,
): SelectionCombineMode | null {
  if (!hasSelection) return null;
  if (modifiers.shift && modifiers.alt) return 'intersect';
  if (modifiers.shift) return 'add';
  if (modifiers.alt) return 'subtract';
  return null;
}

// Starting inside the ants with a selection tool and no boolean modifier
// moves the outline (Ctrl moves the pixels instead).
function beginInsideSelectionDrag(
  tool: EditorTool,
  point: PaintPoint,
  modifiers: DragModifiers,
  insideSelection: boolean,
  override: SelectionCombineMode | null,
): EditorDrag | null {
  const isSelectionTool = tool.kind === 'marquee' || tool.kind === 'lasso';
  if (!isSelectionTool || !insideSelection || override !== null) return null;
  return modifiers.ctrl
    ? { kind: 'move-selection', from: point, to: point }
    : { kind: 'move-outline', from: point, to: point };
}

export function beginDrag(
  tool: EditorTool,
  point: PaintPoint,
  modifiers: DragModifiers,
  hasSelection: boolean,
  insideSelection: boolean,
): EditorDrag {
  const override = booleanFromModifiers(modifiers, hasSelection);
  const insideDrag = beginInsideSelectionDrag(tool, point, modifiers, insideSelection, override);
  if (insideDrag !== null) return insideDrag;
  switch (tool.kind) {
    case 'brush':
    case 'pencil':
    case 'eraser':
      return { kind: 'paint', points: [point] };
    case 'line':
      return { kind: 'line', from: point, to: point, shift: modifiers.shift };
    case 'marquee':
      return {
        kind: 'marquee',
        from: point,
        to: point,
        shape: tool.shape,
        constrain: false,
        fromCenter: false,
        booleanOverride: override,
      };
    case 'lasso':
      return { kind: 'lasso', points: [point], booleanOverride: override };
    case 'wand':
      // Wand is a click tool; the hook commits immediately on down.
      return IDLE_DRAG;
    case 'crop':
      return { kind: 'crop-drag', from: point, to: point };
    case 'move':
      return hasSelection ? { kind: 'move-selection', from: point, to: point } : IDLE_DRAG;
  }
}

export function advanceDrag(
  drag: EditorDrag,
  point: PaintPoint,
  modifiers: DragModifiers,
  spaceHeld: boolean,
): EditorDrag {
  switch (drag.kind) {
    case 'idle':
    case 'pan':
      return drag;
    case 'paint':
      return { kind: 'paint', points: [...drag.points, point] };
    case 'line':
      return { ...drag, to: point, shift: modifiers.shift };
    case 'marquee':
      return advanceMarquee(drag, point, modifiers, spaceHeld);
    case 'lasso':
      return { ...drag, points: [...drag.points, point] };
    case 'crop-drag':
    case 'move-outline':
    case 'move-selection':
      return { ...drag, to: point };
  }
}

/** Normalized rect of a two-point drag (crop). */
export function dragRect(drag: { readonly from: PaintPoint; readonly to: PaintPoint }): PixelRect {
  return {
    x: Math.min(drag.from.x, drag.to.x),
    y: Math.min(drag.from.y, drag.to.y),
    width: Math.abs(drag.to.x - drag.from.x),
    height: Math.abs(drag.to.y - drag.from.y),
  };
}

function advanceMarquee(
  drag: Extract<EditorDrag, { kind: 'marquee' }>,
  point: PaintPoint,
  modifiers: DragModifiers,
  spaceHeld: boolean,
): EditorDrag {
  if (spaceHeld) {
    // Spacebar repositions the in-progress marquee without dropping it.
    const dx = point.x - drag.to.x;
    const dy = point.y - drag.to.y;
    return { ...drag, from: { x: drag.from.x + dx, y: drag.from.y + dy }, to: point };
  }
  const free = drag.booleanOverride === null;
  return {
    ...drag,
    to: point,
    constrain: free && modifiers.shift,
    fromCenter: free && modifiers.alt,
  };
}

/** The marquee's document rect honouring constrain (square) + from-centre. */
export function marqueeRect(drag: Extract<EditorDrag, { kind: 'marquee' }>): PixelRect {
  let dx = drag.to.x - drag.from.x;
  let dy = drag.to.y - drag.from.y;
  if (drag.constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (drag.fromCenter) {
    return {
      x: drag.from.x - Math.abs(dx),
      y: drag.from.y - Math.abs(dy),
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    };
  }
  return {
    x: Math.min(drag.from.x, drag.from.x + dx),
    y: Math.min(drag.from.y, drag.from.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}
