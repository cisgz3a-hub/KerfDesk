// Canvas2D drawing helpers for the workspace viewport. Stateless — every
// function takes the rendering context, the project, and the precomputed
// ViewTransform. This file is the entry-point + per-layer dispatcher;
// per-feature renderers live in sibling files so no single file grows
// beyond the 250-line soft cap (CLAUDE.md).

import { canvasTheme } from '../theme/canvas-theme';
import type { Toolpath } from '../../core/job';
import {
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  transformedBBox,
} from '../../core/scene';
import { buildPreviewToolpath, drawObjectsFaint, drawPreview } from './draw-preview';
import { drawNoGoZones } from './draw-no-go-zones';
import { drawPenDraft } from './draw-pen-preview';
import { type PenDraft } from '../state/ui-store';
import {
  buildDisplayPolylines,
  type DisplayPolylineCache,
  type DisplayPolylines,
} from './display-polylines';
import { drawRasterImage, pruneRasterImageCaches } from './draw-raster';
import { drawRasterPreview } from './draw-raster-preview';
import { drawRulers } from './draw-rulers';
import { type Handle, HANDLE_SCREEN_PX, handlesFor, selectionFrameFor } from './handles';
import { isObjectOutOfBed } from './out-of-bounds';
import { rotateHandlePosition } from './rotate-handle';
import { computeView, type ViewState, type ViewTransform } from './view-transform';
import {
  drawLargeSceneNotice,
  fillClosedPolylinesBatched,
  strokePolylinesBatched,
} from './draw-vector-strokes';

export type DrawOpts = {
  readonly selectedId: string | null;
  // Extra selection (F-A5 multi-select). Drawn with a thinner secondary
  // outline so the user can still tell which is the primary (handles only
  // render on the primary in Phase A).
  readonly additionalSelectedIds?: ReadonlySet<string>;
  readonly preview: boolean;
  // 0..1 scrubber fraction (F-A8). Only consulted when `preview` is true;
  // 1.0 = full toolpath, < 1.0 = render up to that arc-length and draw a
  // head marker at the cursor position.
  readonly scrubberT?: number;
  readonly onRasterBitmapReady?: () => void;
  readonly displayPolylineCache?: DisplayPolylineCache;
  readonly previewToolpath?: Toolpath;
  readonly previewShowTravel?: boolean;
  // User zoom + pan (F-A15). Defaults to fit-to-bed when omitted.
  readonly view?: ViewState;
  // Phase G (B5): the shape being dragged out right now, drawn as a dashed
  // accent outline so size + position are visible live before commit. Null
  // when not drawing.
  readonly draft?: SceneObject;
  // Phase G (B6): the pen tool's in-progress polyline (placed vertices +
  // rubber-band to the cursor). Null unless the pen is mid-draw.
  readonly penDraft?: PenDraft;
};

export function drawScene(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  project: Project,
  opts: DrawOpts,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  pruneRasterImageCaches(liveRasterDataUrls(project));
  const view = computeView(
    canvasW,
    canvasH,
    project.device.bedWidth,
    project.device.bedHeight,
    opts.view,
  );
  drawBed(ctx, project, view);
  drawGrid(ctx, project, view);
  drawNoGoZones(ctx, project, view);
  drawOriginMarker(ctx, view);
  if (opts.preview) {
    drawObjectsFaint(ctx, project, view);
    // Raster sim under the vector toolpath: image engrave is the burned
    // "background", cuts/scans layer on top (matches LightBurn preview).
    drawRasterPreview(ctx, project, view);
    drawPreview(
      ctx,
      opts.previewToolpath ?? buildPreviewToolpath(project),
      view,
      opts.scrubberT ?? 1,
      { showTravel: opts.previewShowTravel !== false },
    );
  } else {
    const simplified = drawObjects(
      ctx,
      project,
      view,
      opts.selectedId,
      opts.additionalSelectedIds,
      opts.onRasterBitmapReady,
      opts.displayPolylineCache,
    );
    if (simplified) drawLargeSceneNotice(ctx);
    if (opts.draft !== undefined) drawDraftShape(ctx, opts.draft, view);
    if (opts.penDraft !== undefined) drawPenDraft(ctx, opts.penDraft, view);
  }
  drawOutOfBoundsOutlines(ctx, project, view);
  // Rulers go LAST so they're on top of everything else (F-A2).
  drawRulers(ctx, canvasW, canvasH, view);
}

// Phase G (B5): render the shape being dragged out as a dashed accent outline.
// Reuses the object stroke path (strokePolylinesBatched applies the object's
// own transform), so the preview matches exactly what mouse-up will commit.
function drawDraftShape(
  ctx: CanvasRenderingContext2D,
  draft: SceneObject,
  view: ViewTransform,
): void {
  if (draft.kind !== 'shape') return;
  ctx.save();
  ctx.strokeStyle = draft.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  for (const path of draft.paths) strokePolylinesBatched(ctx, draft, path.polylines, view);
  ctx.restore();
}

function liveRasterDataUrls(project: Project): Set<string> {
  const live = new Set<string>();
  for (const obj of project.scene.objects) {
    if (obj.kind === 'raster-image') live.add(obj.dataUrl);
  }
  return live;
}

function drawBed(ctx: CanvasRenderingContext2D, project: Project, view: ViewTransform): void {
  ctx.fillStyle = canvasTheme.bedFill;
  ctx.fillRect(
    view.offsetX,
    view.offsetY,
    project.device.bedWidth * view.scale,
    project.device.bedHeight * view.scale,
  );
  ctx.strokeStyle = canvasTheme.bedStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    view.offsetX,
    view.offsetY,
    project.device.bedWidth * view.scale,
    project.device.bedHeight * view.scale,
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, project: Project, view: ViewTransform): void {
  ctx.strokeStyle = canvasTheme.grid;
  ctx.lineWidth = 0.5;
  for (let x = 10; x < project.device.bedWidth; x += 10) {
    ctx.beginPath();
    ctx.moveTo(view.offsetX + x * view.scale, view.offsetY);
    ctx.lineTo(view.offsetX + x * view.scale, view.offsetY + project.device.bedHeight * view.scale);
    ctx.stroke();
  }
  for (let y = 10; y < project.device.bedHeight; y += 10) {
    ctx.beginPath();
    ctx.moveTo(view.offsetX, view.offsetY + y * view.scale);
    ctx.lineTo(view.offsetX + project.device.bedWidth * view.scale, view.offsetY + y * view.scale);
    ctx.stroke();
  }
}

function drawOriginMarker(ctx: CanvasRenderingContext2D, view: ViewTransform): void {
  const cx = view.offsetX;
  const cy = view.offsetY;
  const armPx = 8;
  ctx.strokeStyle = canvasTheme.origin;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - armPx, cy);
  ctx.lineTo(cx + armPx, cy);
  ctx.moveTo(cx, cy - armPx);
  ctx.lineTo(cx, cy + armPx);
  ctx.stroke();
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function drawObjects(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  selectedId: string | null,
  additionalSelectedIds: ReadonlySet<string> = EMPTY_SELECTION,
  onRasterBitmapReady?: () => void,
  displayPolylineCache?: DisplayPolylineCache,
): boolean {
  const layerByColor = new Map(project.scene.layers.map((l) => [l.color, l]));
  let simplified = false;
  for (const obj of project.scene.objects) {
    // ImportedSvg and TextObject share the same polyline shape after
    // text renders to paths in the UI layer — single drawing path.
    if (drawObjectPolylines(ctx, obj, layerByColor, view, displayPolylineCache)) {
      simplified = true;
    }
    // F.2.c: raster images render via Canvas2D drawImage rather than
    // polyline strokes. The bitmap displays at its mm-bounds; the
    // dither preview overlay is a separate render layer we can add
    // later if needed. Hiding the layer hides its bitmaps (M23) —
    // an orphan color with no layer stays visible so artwork never
    // silently disappears.
    if (obj.kind === 'raster-image' && layerByColor.get(obj.color)?.visible !== false) {
      drawRasterImage(
        ctx,
        obj,
        view,
        onRasterBitmapReady === undefined ? undefined : { onBitmapReady: onRasterBitmapReady },
      );
    }
    if (obj.id === selectedId) {
      drawSelectionBox(ctx, obj, view);
    } else if (additionalSelectedIds.has(obj.id)) {
      drawSecondarySelectionBox(ctx, obj, view);
    }
  }
  return simplified;
}

function drawObjectPolylines(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layerByColor: Map<string, Layer>,
  view: ViewTransform,
  displayPolylineCache: DisplayPolylineCache | undefined,
): boolean {
  // imported-svg, text, AND traced-image all carry the same
  // ColoredPath[] shape — single drawing path. Each variant
  // populates `paths` upstream (parseSvg for SVG, textToPolylines
  // for text, traceImageToSvgString→parseSvg for traced image).
  if (
    obj.kind !== 'imported-svg' &&
    obj.kind !== 'text' &&
    obj.kind !== 'traced-image' &&
    obj.kind !== 'shape'
  ) {
    return false;
  }
  let simplified = false;
  for (const path of obj.paths) {
    const layer = layerByColor.get(path.color);
    if (layer === undefined || !layer.visible) continue;
    if (layer.mode === 'fill') {
      drawFilledDesignGeometry(ctx, obj, path.polylines, layer, view, path.color);
      continue;
    }
    ctx.strokeStyle = path.color;
    ctx.lineWidth = layer.output ? 1.5 : 0.75;
    // Single beginPath/stroke per color, regardless of how many
    // polylines that color has. Per-polyline stroke() was the cause
    // of the post-import freeze: each stroke is a GPU sync, so a
    // 5000-polyline traced image emitted 5000 syncs per redraw at
    // 60 Hz → canvas chokes. Batching to one stroke per color drops
    // that to O(colors) ≈ 1-8. Standard Canvas2D pattern (MDN).
    const display = displayPolylinesFor(path.polylines, displayPolylineCache);
    if (display.isSimplified) simplified = true;
    strokePolylinesBatched(ctx, obj, display.polylines, view);
  }
  return simplified;
}

function displayPolylinesFor(
  polylines: ReadonlyArray<Polyline>,
  cache: DisplayPolylineCache | undefined,
): DisplayPolylines {
  return cache?.get(polylines) ?? buildDisplayPolylines(polylines);
}

function drawFilledDesignGeometry(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  layer: Layer,
  view: ViewTransform,
  color: string,
): void {
  const closed = polylines.filter((polyline) => polyline.closed);
  const open = polylines.filter((polyline) => !polyline.closed);

  if (closed.length > 0) {
    ctx.fillStyle = color;
    fillClosedPolylinesBatched(ctx, obj, closed, view, obj.kind === 'text' ? 'nonzero' : 'evenodd');
  }
  if (open.length === 0) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = layer.output ? 1.5 : 0.75;
  strokePolylinesBatched(ctx, obj, open, view);
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  strokeSelectionFrame(ctx, selectionFrameFor(obj), view);
  ctx.setLineDash([]);
  drawHandles(ctx, obj, view);
}

// Thinner, no-handles outline for objects in the multi-selection set.
// Handles only appear on the primary so the user knows which object the
// next scale/rotate drag will affect.
function drawSecondarySelectionBox(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.globalAlpha = 0.7;
  strokeSelectionFrame(ctx, selectionFrameFor(obj), view);
  ctx.restore();
}

function strokeSelectionFrame(
  ctx: CanvasRenderingContext2D,
  frame: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  view: ViewTransform,
): void {
  const [first, ...rest] = frame;
  if (first === undefined) return;
  ctx.beginPath();
  ctx.moveTo(view.offsetX + first.x * view.scale, view.offsetY + first.y * view.scale);
  for (const point of rest) {
    ctx.lineTo(view.offsetX + point.x * view.scale, view.offsetY + point.y * view.scale);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawHandles(ctx: CanvasRenderingContext2D, obj: SceneObject, view: ViewTransform): void {
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  const half = HANDLE_SCREEN_PX / 2;
  for (const h of handlesFor(obj)) drawSingleHandle(ctx, h, view, half);
  drawRotateHandle(ctx, obj, view);
}

function drawSingleHandle(
  ctx: CanvasRenderingContext2D,
  h: Handle,
  view: ViewTransform,
  half: number,
): void {
  const cx = view.offsetX + h.position.x * view.scale;
  const cy = view.offsetY + h.position.y * view.scale;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
}

function drawRotateHandle(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  const pos = rotateHandlePosition(obj);
  const cx = view.offsetX + pos.x * view.scale;
  const cy = view.offsetY + pos.y * view.scale;
  const bboxTopMidScreenY = cy + 24 * view.scale;
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(cx, bboxTopMidScreenY);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = canvasTheme.selection;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = canvasTheme.rotateHandleStroke;
  ctx.stroke();
  ctx.restore();
}

// F-A3/A6/A8 — overlay any object whose transformed bbox extends past the
// bed in scene coordinates with a red dashed rectangle. Preflight (F-A10)
// blocks at G-code generation time; this is the live UX hint.
function drawOutOfBoundsOutlines(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  const bedW = project.device.bedWidth;
  const bedH = project.device.bedHeight;
  for (const obj of project.scene.objects) {
    if (!isObjectOutOfBed(obj, bedW, bedH)) continue;
    const bbox = transformedBBox(obj);
    ctx.save();
    ctx.strokeStyle = canvasTheme.outOfBounds;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      view.offsetX + bbox.minX * view.scale,
      view.offsetY + bbox.minY * view.scale,
      (bbox.maxX - bbox.minX) * view.scale,
      (bbox.maxY - bbox.minY) * view.scale,
    );
    ctx.restore();
  }
}
