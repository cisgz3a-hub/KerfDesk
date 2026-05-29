// Canvas2D drawing helpers for the workspace viewport. Stateless — every
// function takes the rendering context, the project, and the precomputed
// ViewTransform. This file is the entry-point + per-layer dispatcher;
// per-feature renderers live in sibling files so no single file grows
// beyond the 250-line soft cap (CLAUDE.md).

import { fillHatching } from '../../core/job/fill-hatching';
import {
  applyTransform,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  transformedBBox,
} from '../../core/scene';
import { drawObjectsFaint, drawPreview } from './draw-preview';
import { drawRasterImage } from './draw-raster';
import { drawRasterPreview } from './draw-raster-preview';
import { drawRulers } from './draw-rulers';
import { type Handle, HANDLE_SCREEN_PX, handlesFor } from './handles';
import { rotateHandlePosition } from './rotate-handle';
import { computeView, type ViewState, type ViewTransform } from './view-transform';

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
  // User zoom + pan (F-A15). Defaults to fit-to-bed when omitted.
  readonly view?: ViewState;
};

export function drawScene(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  project: Project,
  opts: DrawOpts,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  const view = computeView(
    canvasW,
    canvasH,
    project.device.bedWidth,
    project.device.bedHeight,
    opts.view,
  );
  drawBed(ctx, project, view);
  drawGrid(ctx, project, view);
  drawOriginMarker(ctx, view);
  if (opts.preview) {
    drawObjectsFaint(ctx, project, view);
    // Raster sim under the vector toolpath: image engrave is the burned
    // "background", cuts/scans layer on top (matches LightBurn preview).
    drawRasterPreview(ctx, project, view);
    drawPreview(ctx, project, view, opts.scrubberT ?? 1);
  } else {
    drawObjects(ctx, project, view, opts.selectedId, opts.additionalSelectedIds);
  }
  drawOutOfBoundsOutlines(ctx, project, view);
  // Rulers go LAST so they're on top of everything else (F-A2).
  drawRulers(ctx, canvasW, canvasH, view);
}

function drawBed(ctx: CanvasRenderingContext2D, project: Project, view: ViewTransform): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(
    view.offsetX,
    view.offsetY,
    project.device.bedWidth * view.scale,
    project.device.bedHeight * view.scale,
  );
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    view.offsetX,
    view.offsetY,
    project.device.bedWidth * view.scale,
    project.device.bedHeight * view.scale,
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, project: Project, view: ViewTransform): void {
  ctx.strokeStyle = '#d8d8d8';
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
  ctx.strokeStyle = '#cc0000';
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
): void {
  const layerByColor = new Map(project.scene.layers.map((l) => [l.color, l]));
  for (const obj of project.scene.objects) {
    // ImportedSvg and TextObject share the same polyline shape after
    // text renders to paths in the UI layer — single drawing path.
    drawObjectPolylines(ctx, obj, layerByColor, view);
    // F.2.c: raster images render via Canvas2D drawImage rather than
    // polyline strokes. The bitmap displays at its mm-bounds; the
    // dither preview overlay is a separate render layer we can add
    // later if needed.
    if (obj.kind === 'raster-image') {
      drawRasterImage(ctx, obj, view);
    }
    if (obj.id === selectedId) {
      drawSelectionBox(ctx, obj, view);
    } else if (additionalSelectedIds.has(obj.id)) {
      drawSecondarySelectionBox(ctx, obj, view);
    }
  }
}

function drawObjectPolylines(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layerByColor: Map<string, Layer>,
  view: ViewTransform,
): void {
  // imported-svg, text, AND traced-image all carry the same
  // ColoredPath[] shape — single drawing path. Each variant
  // populates `paths` upstream (parseSvg for SVG, textToPolylines
  // for text, traceImageToSvgString→parseSvg for traced image).
  if (obj.kind !== 'imported-svg' && obj.kind !== 'text' && obj.kind !== 'traced-image') return;
  for (const path of obj.paths) {
    const layer = layerByColor.get(path.color);
    if (layer === undefined || !layer.visible) continue;
    if (layer.mode === 'fill') {
      // Fill-mode preview: show the actual hatch pattern that will burn
      // (LightBurn-style WYSIWYG). Outline drops to a faint guide stroke
      // so the user still sees the shape boundary. fillHatching is the
      // exact function compileJob runs at emit time, so what you see is
      // what gets G-code'd. Sub-ms per typical object — no cache needed
      // until profiling says otherwise.
      drawOutlineFaint(ctx, obj, path.polylines, view, path.color);
      drawFillHatches(ctx, obj, path.polylines, layer, view, path.color);
    } else {
      ctx.strokeStyle = path.color;
      ctx.lineWidth = layer.output ? 1.5 : 0.75;
      // Single beginPath/stroke per color, regardless of how many
      // polylines that color has. Per-polyline stroke() was the cause
      // of the post-import freeze: each stroke is a GPU sync, so a
      // 5000-polyline traced image emitted 5000 syncs per redraw at
      // 60 Hz → canvas chokes. Batching to one stroke per color drops
      // that to O(colors) ≈ 1-8. Standard Canvas2D pattern (MDN).
      strokePolylinesBatched(ctx, obj, path.polylines, view);
    }
  }
}

// Faint outline drawn as a guide under the hatch lines in Fill mode.
// Same batched stroke as the line path, just with a thinner dashed
// stroke at the layer color (alpha-dimmed via ctx.globalAlpha) so the
// hatches read as the actual burn pattern, not a competing fill.
function drawOutlineFaint(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.75;
  ctx.setLineDash([3, 3]);
  strokePolylinesBatched(ctx, obj, polylines, view);
  ctx.restore();
}

// Run fillHatching on the source polylines and draw the resulting
// hatch lines at the layer's actual color + line weight. Mirrors what
// compileJob → grbl-strategy will emit, so the canvas matches the
// G-code 1:1.
function drawFillHatches(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  layer: Layer,
  view: ViewTransform,
  color: string,
): void {
  const hatches = fillHatching({
    polylines,
    hatchAngleDeg: layer.hatchAngleDeg,
    hatchSpacingMm: layer.hatchSpacingMm,
  });
  if (hatches.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = layer.output ? 1.5 : 0.75;
  strokePolylinesBatched(ctx, obj, hatches, view);
}

// Extracted batched-stroke helper used by both line mode and the
// outline-guide / hatch-line paths in fill mode. One beginPath/stroke
// per call — see the comment block on drawObjectPaths for why.
function strokePolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
): void {
  ctx.beginPath();
  for (const polyline of polylines) {
    for (let i = 0; i < polyline.points.length; i += 1) {
      const raw = polyline.points[i];
      if (raw === undefined) continue;
      const p = applyTransform(raw, obj.transform);
      const cx = view.offsetX + p.x * view.scale;
      const cy = view.offsetY + p.y * view.scale;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
  }
  ctx.stroke();
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  const bbox = transformedBBox(obj);
  ctx.strokeStyle = '#1976d2';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(
    view.offsetX + bbox.minX * view.scale,
    view.offsetY + bbox.minY * view.scale,
    (bbox.maxX - bbox.minX) * view.scale,
    (bbox.maxY - bbox.minY) * view.scale,
  );
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
  const bbox = transformedBBox(obj);
  ctx.save();
  ctx.strokeStyle = '#1976d2';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.globalAlpha = 0.7;
  ctx.strokeRect(
    view.offsetX + bbox.minX * view.scale,
    view.offsetY + bbox.minY * view.scale,
    (bbox.maxX - bbox.minX) * view.scale,
    (bbox.maxY - bbox.minY) * view.scale,
  );
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, obj: SceneObject, view: ViewTransform): void {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1976d2';
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
  ctx.strokeStyle = '#1976d2';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(cx, bboxTopMidScreenY);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1976d2';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
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
    const bbox = transformedBBox(obj);
    const outOfBounds = bbox.minX < 0 || bbox.minY < 0 || bbox.maxX > bedW || bbox.maxY > bedH;
    if (!outOfBounds) continue;
    ctx.save();
    ctx.strokeStyle = '#c62828';
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
