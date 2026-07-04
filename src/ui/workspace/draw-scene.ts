// Canvas2D drawing helpers for the workspace viewport. Stateless — every
// function takes the rendering context, the project, and the precomputed
// ViewTransform. This file is the entry-point + per-layer dispatcher;
// per-feature renderers live in sibling files so no single file grows
// beyond the 250-line soft cap (CLAUDE.md).

import { canvasTheme } from '../theme/canvas-theme';
import type { Toolpath } from '../../core/job';
import {
  isRegistrationBox,
  sceneObjectHasVisibleLayerFromMap,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { drawObjectsFaint, drawPreview } from './draw-preview';
import { drawMeasurement } from './draw-measurement';
import { drawNoGoZones } from './draw-no-go-zones';
import { drawSelectedOpenFillContours } from './draw-open-fill-contours';
import { drawPenDraft } from './draw-pen-preview';
import { type PenDraft, type SelectionMarquee } from '../state/ui-store';
import type { MeasureDraft } from './measure-tool';
import { drawSelectionMarquee } from './draw-selection-marquee';
import { drawSnapGuides } from './draw-snap-guides';
import type { SnapGuide } from './snapping';
import {
  buildDisplayPolylines,
  type DisplayPolylineCache,
  type DisplayPolylines,
} from './display-polylines';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { drawCncRemoval } from './draw-cnc-removal';
import { drawRasterImage, pruneRasterImageCaches } from './draw-raster';
import { drawRasterPreview } from './draw-raster-preview';
import { drawCncStock } from './draw-stock';
import { drawReliefObject } from './draw-relief';
import type { RemovalGrid } from '../../core/sim';
import { drawRulers } from './draw-rulers';
import { drawOutOfBoundsOutlines } from './draw-out-of-bounds-outlines';
import { drawObjectSelectionOverlay, drawSelectionSetOverlay } from './draw-selection-overlay';
import { computeView, type ViewState, type ViewTransform } from './view-transform';
import {
  drawLargeSceneNotice,
  fillClosedPolylinesBatched,
  strokePolylinesBatched,
} from './draw-vector-strokes';

export type DrawOpts = {
  readonly selectedId: string | null;
  readonly showPathNodeHandles?: boolean;
  readonly selectedPathNode?: PathNodeRef | null;
  readonly selectedPathNodes?: ReadonlyArray<PathNodeRef>;
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
  // CNC preview (H.2): the scene-space material-removal grid, depth-shaded
  // under the route lines. Null/omitted for laser projects.
  readonly cncRemovalGrid?: RemovalGrid | null;
  // User zoom + pan (F-A15). Defaults to fit-to-bed when omitted.
  readonly view?: ViewState;
  // Phase G (B5): the shape being dragged out right now, drawn as a dashed
  // accent outline so size + position are visible live before commit. Null
  // when not drawing.
  readonly draft?: SceneObject;
  // Phase G (B6): the pen tool's in-progress polyline (placed vertices +
  // rubber-band to the cursor). Null unless the pen is mid-draw.
  readonly penDraft?: PenDraft;
  readonly selectionMarquee?: SelectionMarquee;
  readonly measureDraft?: MeasureDraft;
  readonly snapGuides?: ReadonlyArray<SnapGuide>;
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
  // Stock footprint under everything else (CNC mode only — no-op for laser).
  drawCncStock(ctx, project, view);
  drawNoGoZones(ctx, project, view);
  drawOriginMarker(ctx, view);
  if (opts.preview) {
    drawPreviewModeScene(ctx, project, view, opts);
  } else {
    const simplified = drawObjects(
      ctx,
      project,
      view,
      opts.selectedId,
      opts.showPathNodeHandles === true,
      opts.selectedPathNode ?? null,
      opts.selectedPathNodes ??
        (opts.selectedPathNode === undefined || opts.selectedPathNode === null
          ? []
          : [opts.selectedPathNode]),
      opts.additionalSelectedIds,
      opts.onRasterBitmapReady,
      opts.displayPolylineCache,
    );
    if (simplified) drawLargeSceneNotice(ctx);
    drawSelectedOpenFillContours(
      ctx,
      project,
      view,
      opts.selectedId,
      opts.additionalSelectedIds ?? EMPTY_SELECTION,
    );
    drawLiveWorkspaceOverlays(ctx, opts, view);
  }
  if (!opts.preview) drawSnapGuides(ctx, opts.snapGuides ?? [], view);
  drawOutOfBoundsOutlines(ctx, project, view);
  // Rulers go LAST so they're on top of everything else (F-A2).
  drawRulers(ctx, canvasW, canvasH, view);
}

// Preview-mode frame: faint artwork, raster sim, CNC removal shading, then
// the route lines on top (matches LightBurn's preview layering).
function drawPreviewModeScene(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  opts: DrawOpts,
): void {
  drawObjectsFaint(ctx, project, view);
  // Raster sim under the vector toolpath: image engrave is the burned
  // "background", cuts/scans layer on top (matches LightBurn preview).
  drawRasterPreview(
    ctx,
    project,
    view,
    opts.onRasterBitmapReady === undefined
      ? {}
      : { onRasterPreviewReady: opts.onRasterBitmapReady },
  );
  // CNC material-removal shading under the route lines (H.2).
  if (opts.cncRemovalGrid != null) drawCncRemoval(ctx, opts.cncRemovalGrid, view);
  if (opts.previewToolpath === undefined) return;
  drawPreview(ctx, opts.previewToolpath, view, opts.scrubberT ?? 1, {
    showTravel: opts.previewShowTravel !== false,
    showFuture: true,
    showEndpoints: true,
  });
}

function drawLiveWorkspaceOverlays(
  ctx: CanvasRenderingContext2D,
  opts: DrawOpts,
  view: ViewTransform,
): void {
  if (opts.draft !== undefined) drawDraftShape(ctx, opts.draft, view);
  if (opts.penDraft !== undefined) drawPenDraft(ctx, opts.penDraft, view);
  if (opts.selectionMarquee !== undefined) drawSelectionMarquee(ctx, opts.selectionMarquee, view);
  if (opts.measureDraft !== undefined) drawMeasurement(ctx, opts.measureDraft, view);
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
  showPathNodeHandles: boolean,
  selectedPathNode: PathNodeRef | null,
  selectedPathNodes: ReadonlyArray<PathNodeRef>,
  additionalSelectedIds: ReadonlySet<string> = EMPTY_SELECTION,
  onRasterBitmapReady?: () => void,
  displayPolylineCache?: DisplayPolylineCache,
): boolean {
  const layerByColor = new Map(project.scene.layers.map((l) => [l.color, l]));
  let simplified = false;
  for (const obj of project.scene.objects) {
    const isVisible = sceneObjectHasVisibleLayerFromMap(obj, layerByColor);
    // ImportedSvg and TextObject share the same polyline shape after text renders
    // to paths — single drawing path. ADR-057: dash the jig box so it reads as a
    // placement fixture, not artwork; reset after, before the overlays below.
    ctx.setLineDash(isRegistrationBox(obj) ? [8, 5] : []);
    if (drawObjectPolylines(ctx, obj, layerByColor, view, displayPolylineCache)) {
      simplified = true;
    }
    ctx.setLineDash([]);
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
    // H.4: reliefs render as grayscale depth maps (light = top, dark = floor).
    if (obj.kind === 'relief') drawReliefObject(ctx, obj, layerByColor, view);
    drawObjectSelectionOverlay(ctx, obj, view, {
      isVisible,
      selectedId,
      showPathNodeHandles,
      selectedPathNode,
      selectedPathNodes,
      additionalSelectedIds,
    });
  }
  const selectionObjects = selectedObjectsForOverlay(
    project.scene.objects,
    selectedId,
    additionalSelectedIds,
    layerByColor,
  );
  if (selectionObjects.length > 1) drawSelectionSetOverlay(ctx, selectionObjects, view);
  return simplified;
}

function selectedObjectsForOverlay(
  objects: ReadonlyArray<SceneObject>,
  selectedId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
  layerByColor: Map<string, Layer>,
): ReadonlyArray<SceneObject> {
  if (selectedId === null || additionalSelectedIds.size === 0) return [];
  const selectedIds = new Set([selectedId, ...additionalSelectedIds]);
  return objects.filter(
    (object) =>
      selectedIds.has(object.id) && sceneObjectHasVisibleLayerFromMap(object, layerByColor),
  );
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
    const effectiveLayer =
      obj.operationOverride === undefined ? layer : { ...layer, ...obj.operationOverride };
    if (effectiveLayer.mode === 'fill') {
      drawFilledDesignGeometry(ctx, obj, path.polylines, effectiveLayer, view, path.color);
      continue;
    }
    ctx.strokeStyle = path.color;
    ctx.lineWidth = effectiveLayer.output ? 1.5 : 0.75;
    // Single beginPath/stroke per color. Per-polyline stroke() was the cause
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

// F-A3/A6/A8 — overlay any object whose transformed bbox extends past the
