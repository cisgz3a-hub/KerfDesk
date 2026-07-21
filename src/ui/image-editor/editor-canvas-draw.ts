// Canvas rendering for the Image Studio (ADR-242): the working document at
// the current view transform, the marching-ants selection outline, and the
// in-progress tool preview. On-change redraw (no free-running rAF); only the
// ants dash phase ticks while a selection exists.

import type { RgbaBuffer } from '../../core/image-edit';
import { maskOutline, type SelectionMask } from '../../core/image-select';
import type { EditorDrag } from './editor-drag';
import { marqueeRect } from './editor-drag';
import type { EditorView } from './image-editor-types';

export const ANTS_DASH_PX = 4;

// Canvas-rendered drawing colors, not DOM chrome: marching ants are
// white/black by definition, the selection preview uses a fixed accent, and
// the surround matches the sunken workspace backdrop. Canvas contexts cannot
// resolve var(--lf-*) tokens, hence literals.
/* eslint-disable no-restricted-syntax */
export const EDITOR_BACKDROP = '#333333';
const PREVIEW_ACCENT = '#44aaff';
const ANTS_LIGHT = '#ffffff';
const ANTS_DARK = '#000000';
/* eslint-enable no-restricted-syntax */

export function docToCanvas(doc: RgbaBuffer): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(doc.data), doc.width, doc.height), 0, 0);
  }
  return canvas;
}

export function fitView(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
): EditorView {
  const scale = Math.min(viewWidth / docWidth, viewHeight / docHeight) * 0.94;
  return {
    scale,
    panX: (viewWidth - docWidth * scale) / 2,
    panY: (viewHeight - docHeight * scale) / 2,
  };
}

export function canvasToDoc(view: EditorView, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.panX) / view.scale, y: (y - view.panY) / view.scale };
}

export function drawEditorScene(
  ctx: CanvasRenderingContext2D,
  docCanvas: HTMLCanvasElement,
  view: EditorView,
  selection: SelectionMask | null,
  drag: EditorDrag,
  antsPhase: number,
  previewStyle: { readonly color: string; readonly widthPx: number },
): void {
  ctx.save();
  ctx.fillStyle = EDITOR_BACKDROP;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.scale, view.scale);
  ctx.imageSmoothingEnabled = view.scale < 1;
  ctx.drawImage(docCanvas, 0, 0);
  drawDragPreview(ctx, drag, view, previewStyle);
  if (selection !== null) drawAnts(ctx, selection, view, antsPhase);
  ctx.restore();
}

function drawDragPreview(
  ctx: CanvasRenderingContext2D,
  drag: EditorDrag,
  view: EditorView,
  style: { readonly color: string; readonly widthPx: number },
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (drag.kind) {
    case 'idle':
    case 'pan':
    case 'move-selection':
      break;
    case 'paint':
    case 'lasso': {
      ctx.strokeStyle = drag.kind === 'lasso' ? PREVIEW_ACCENT : style.color;
      ctx.lineWidth = drag.kind === 'lasso' ? 1 / view.scale : style.widthPx;
      if (drag.kind === 'lasso') ctx.setLineDash([4 / view.scale, 3 / view.scale]);
      strokePolyline(ctx, drag.points);
      break;
    }
    case 'line': {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.widthPx;
      strokePolyline(ctx, [drag.from, drag.to]);
      break;
    }
    case 'marquee': {
      const rect = marqueeRect(drag);
      ctx.strokeStyle = PREVIEW_ACCENT;
      ctx.lineWidth = 1 / view.scale;
      ctx.setLineDash([4 / view.scale, 3 / view.scale]);
      if (drag.ellipse) {
        ctx.beginPath();
        ctx.ellipse(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          rect.width / 2,
          rect.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      } else {
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
): void {
  const first = points[0];
  if (first === undefined) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function drawAnts(
  ctx: CanvasRenderingContext2D,
  selection: SelectionMask,
  view: EditorView,
  phase: number,
): void {
  const loops = maskOutline(selection);
  const dash = ANTS_DASH_PX / view.scale;
  ctx.lineWidth = 1 / view.scale;
  for (const pass of [
    { color: ANTS_LIGHT, offset: phase },
    { color: ANTS_DARK, offset: phase + dash },
  ]) {
    ctx.strokeStyle = pass.color;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = pass.offset / view.scale;
    for (const loop of loops) {
      const first = loop[0];
      if (first === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of loop) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.stroke();
    }
  }
}
