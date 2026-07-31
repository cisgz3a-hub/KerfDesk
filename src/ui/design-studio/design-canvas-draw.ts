// design-canvas-draw — immediate-mode painting for the Design Studio canvas
// (ADR-272, DS-2).
//
// Two cadences, deliberately (ADR-272 clause 8): this module paints the STATIC
// layer — bed, grid, committed geometry — which only needs repainting when the
// sketch, the view, or the selection changes. The interaction overlay (cursor,
// rubber band, snap markers) lives on its own canvas above this one and repaints
// per pointer move, so moving the mouse never re-strokes the whole drawing.
//
// Colours come from `canvasTheme` (ADR-047), which means the Studio inherits the
// workspace's deliberately LIGHT bed rather than inventing a second look — the
// same WYSIWYG-against-white-material reasoning, and the same palette LightBurn
// uses.
//
// The grid steps up in 1/2/5 decades as you zoom out so it never degenerates
// into a grey wash.

import { entityToPolylines, type Sketch } from '../../core/design';
import { entityDesignLayer, sketchLayers } from '../../core/design/layers';
import type { Polyline, Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { mmToPx } from './design-view';
import type { DesignView } from './design-session';

export type DesignCanvasPaint = {
  readonly view: DesignView;
  readonly sketch: Sketch;
  readonly selectedIds: ReadonlySet<string>;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly showGrid: boolean;
  readonly gridMm: number;
  readonly widthPx: number;
  readonly heightPx: number;
};

const MIN_MINOR_GRID_PX = 6;
const MAJOR_EVERY = 5;
const SELECTED_LINE_WIDTH_PX = 2;
const NORMAL_LINE_WIDTH_PX = 1;
const CONSTRUCTION_DASH_PX: ReadonlyArray<number> = [6, 4];
const MAX_GRID_DECADE_STEPS = 24;
const ORIGIN_ARM_PX = 8;
const ORIGIN_LINE_WIDTH_PX = 1.5;

export function paintDesignCanvas(ctx: CanvasRenderingContext2D, paint: DesignCanvasPaint): void {
  paintBed(ctx, paint);
  if (paint.showGrid) paintGrid(ctx, paint);
  paintOriginMarker(ctx, paint);
  paintEntities(ctx, paint);
}

function paintBed(ctx: CanvasRenderingContext2D, paint: DesignCanvasPaint): void {
  const bed = bedRectPx(paint);
  // A clearly grey surround so the white bed reads as a sheet you are drawing ON.
  ctx.fillStyle = canvasTheme.designSurround;
  ctx.fillRect(0, 0, paint.widthPx, paint.heightPx);
  ctx.fillStyle = canvasTheme.bedFill;
  ctx.fillRect(bed.x, bed.y, bed.width, bed.height);
  ctx.strokeStyle = canvasTheme.bedStroke;
  ctx.lineWidth = NORMAL_LINE_WIDTH_PX;
  ctx.strokeRect(bed.x + 0.5, bed.y + 0.5, bed.width, bed.height);
}

function bedRectPx(paint: DesignCanvasPaint): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const origin = mmToPx(paint.view, { x: 0, y: 0 });
  const far = mmToPx(paint.view, { x: paint.bedWidthMm, y: paint.bedHeightMm });
  return { x: origin.x, y: origin.y, width: far.x - origin.x, height: far.y - origin.y };
}

// The work origin, in the same red the main workspace uses. Without it there is no
// landmark on an empty bed and no way to tell which corner X0 Y0 is.
function paintOriginMarker(ctx: CanvasRenderingContext2D, paint: DesignCanvasPaint): void {
  const at = mmToPx(paint.view, { x: 0, y: 0 });
  ctx.strokeStyle = canvasTheme.origin;
  ctx.lineWidth = ORIGIN_LINE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(at.x - ORIGIN_ARM_PX, at.y);
  ctx.lineTo(at.x + ORIGIN_ARM_PX, at.y);
  ctx.moveTo(at.x, at.y - ORIGIN_ARM_PX);
  ctx.lineTo(at.x, at.y + ORIGIN_ARM_PX);
  ctx.stroke();
}

// Chooses a step that is at least MIN_MINOR_GRID_PX on screen, walking the
// 1 / 2 / 5 decade ladder up from the configured spacing.
export function gridStepMm(gridMm: number, pxPerMm: number): number {
  const base = gridMm > 0 && Number.isFinite(gridMm) ? gridMm : 1;
  if (!(pxPerMm > 0)) return base;
  let step = base;
  let guard = 0;
  while (step * pxPerMm < MIN_MINOR_GRID_PX && guard < MAX_GRID_DECADE_STEPS) {
    const decade = 10 ** Math.floor(Math.log10(step));
    const mantissa = step / decade;
    step = mantissa < 1.5 ? decade * 2 : mantissa < 3.5 ? decade * 5 : decade * 10;
    guard += 1;
  }
  return step;
}

// Clipped to the bed, as the main workspace grid is. A grid that runs off the sheet
// makes the whole canvas look like drawing area, which is how a part ends up at
// X -100 without the operator noticing.
function paintGrid(ctx: CanvasRenderingContext2D, paint: DesignCanvasPaint): void {
  const step = gridStepMm(paint.gridMm, paint.view.pxPerMm);
  const bed = bedRectPx(paint);
  if (bed.width <= 0 || bed.height <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bed.x, bed.y, bed.width, bed.height);
  ctx.clip();
  ctx.lineWidth = NORMAL_LINE_WIDTH_PX;
  for (let x = step; x < paint.bedWidthMm; x += step) {
    ctx.strokeStyle = isMajorLine(x, step) ? canvasTheme.bedStroke : canvasTheme.grid;
    strokeSegment(
      ctx,
      mmToPx(paint.view, { x, y: 0 }),
      mmToPx(paint.view, { x, y: paint.bedHeightMm }),
    );
  }
  for (let y = step; y < paint.bedHeightMm; y += step) {
    ctx.strokeStyle = isMajorLine(y, step) ? canvasTheme.bedStroke : canvasTheme.grid;
    strokeSegment(
      ctx,
      mmToPx(paint.view, { x: 0, y }),
      mmToPx(paint.view, { x: paint.bedWidthMm, y }),
    );
  }
  ctx.restore();
}

function isMajorLine(valueMm: number, step: number): boolean {
  return Math.round(valueMm / step) % MAJOR_EVERY === 0;
}

// Strokes take the carve layer's colour (scene DATA, like the main canvas's
// operation colours) so the 2D drawing and the layers panel tell one story;
// selection and construction styling still win over the layer tint.
function paintEntities(ctx: CanvasRenderingContext2D, paint: DesignCanvasPaint): void {
  const layers = sketchLayers(paint.sketch);
  for (const entity of paint.sketch.entities) {
    const isSelected = paint.selectedIds.has(entity.id);
    const isGuide = entity.construction === true;
    ctx.strokeStyle = isSelected
      ? canvasTheme.selection
      : isGuide
        ? canvasTheme.designConstruction
        : entityDesignLayer(entity, layers).color;
    ctx.lineWidth = isSelected ? SELECTED_LINE_WIDTH_PX : NORMAL_LINE_WIDTH_PX;
    ctx.setLineDash(isGuide ? [...CONSTRUCTION_DASH_PX] : []);
    for (const polyline of entityToPolylines(entity)) strokePolyline(ctx, paint.view, polyline);
  }
  ctx.setLineDash([]);
}

function strokePolyline(ctx: CanvasRenderingContext2D, view: DesignView, polyline: Polyline): void {
  if (polyline.points.length < 2) return;
  ctx.beginPath();
  polyline.points.forEach((point, index) => {
    const px = mmToPx(view, point);
    if (index === 0) ctx.moveTo(px.x, px.y);
    else ctx.lineTo(px.x, px.y);
  });
  if (polyline.closed) ctx.closePath();
  ctx.stroke();
}

// Half-pixel offset keeps a 1 px line on the pixel grid instead of straddling
// two rows at half intensity, which is what makes a grid look blurry.
function strokeSegment(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(Math.round(from.x) + 0.5, Math.round(from.y) + 0.5);
  ctx.lineTo(Math.round(to.x) + 0.5, Math.round(to.y) + 0.5);
  ctx.stroke();
}
