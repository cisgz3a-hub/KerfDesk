// Canvas2D drawing helpers for the workspace viewport. Stateless — every
// function takes the rendering context, the project, and the precomputed
// ViewTransform. This file is the entry-point + per-layer dispatcher;
// per-feature renderers live in sibling files so no single file grows
// beyond the 250-line soft cap (CLAUDE.md).

import { isChiploadMaterialKey, type ChiploadMaterial } from '../../core/cnc';
import type { Toolpath } from '../../core/job';
import {
  isRegistrationBox,
  sceneLayerVisibility,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { canvasVectorDisplayColor } from '../theme/canvas-vector-color';
import { drawObjectsFaint, drawPreview } from './draw-preview';
import { drawMeasurement } from './draw-measurement';
import { drawNoGoZones } from './draw-no-go-zones';
import { drawSelectedOpenFillContours } from './draw-open-fill-contours';
import { drawRegistrationBoxDimensions } from './draw-registration-dimensions';
import { drawPenDraft } from './draw-pen-preview';
import { type PenDraft, type SelectionMarquee } from '../state/ui-store';
import type { ArtworkRunFocus } from '../state/artwork-run-order-ui';
import type { MeasureDraft } from './measure-tool';
import { drawSelectionMarquee } from './draw-selection-marquee';
import { drawSnapGuides } from './draw-snap-guides';
import type { SnapGuide } from './snapping';
import type { DisplayPolylineCache } from './display-polylines';
import {
  drawObjectDisplay,
  isVectorSceneObject,
  resolveObjectDisplay,
  type ObjectDisplayMode,
} from './object-display';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { drawCncRemoval } from './draw-cnc-removal';
import {
  burnedImageAdjustments,
  drawRasterImage,
  liveAdjustedDisplayKeys,
  pruneRasterImageCaches,
  rasterDisplayDataUrl,
} from './draw-raster';
import { drawRasterPreview } from './draw-raster-preview';
import { drawCncStock } from './draw-stock';
import { drawReliefObject, scheduleReliefPreviews } from './draw-relief';
import type { RemovalGrid } from '../../core/sim';
import { drawRulers } from './draw-rulers';
import { drawOutOfBoundsOutlines } from './draw-out-of-bounds-outlines';
import { drawObjectSelectionOverlay, drawSelectionSetOverlay } from './draw-selection-overlay';
import { drawCncTabAnchors } from './cnc-tab-editor';
import { computeView, type ViewState, type ViewTransform } from './view-transform';
import { drawLargeSceneNotice, strokePolylinesBatched } from './draw-vector-strokes';
import { drawArtworkRunFocus } from './draw-artwork-run-focus';
import { drawBed, drawGrid, drawOriginMarker } from './draw-bed-chrome';

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
  readonly previewBackgroundKey?: object;
  readonly previewRouteRenderer?: (
    ctx: CanvasRenderingContext2D,
    toolpath: Toolpath,
    view: ViewTransform,
    scrubberT: number,
    showTravel: boolean,
    backgroundKey?: object,
  ) => boolean;
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
  readonly cncTabLayerColor?: string;
  readonly artworkRunFocus?: ArtworkRunFocus;
  // ADR-410 Wireframe view: outline Fill artwork instead of filling it.
  readonly wireframe?: boolean;
};

export function drawScene(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  project: Project,
  opts: DrawOpts,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  pruneRasterImageCaches(
    liveRasterDataUrls(project),
    liveAdjustedDisplayKeys(
      project.scene.objects,
      sceneLayerVisibility.lookup(project.scene.layers),
    ),
  );
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
      opts.wireframe === true ? 'wireframe' : 'design',
      opts.additionalSelectedIds,
      opts.onRasterBitmapReady,
      opts.displayPolylineCache,
      opts.artworkRunFocus,
    );
    if (simplified) drawLargeSceneNotice(ctx);
    if (opts.artworkRunFocus !== undefined) {
      drawArtworkRunFocus(ctx, project.scene.objects, opts.artworkRunFocus, view);
    }
    drawSelectedOpenFillContours(
      ctx,
      project,
      view,
      opts.selectedId,
      opts.additionalSelectedIds ?? EMPTY_SELECTION,
    );
    // ADR-124: label the captured-board / jig outline with its measured size.
    drawRegistrationBoxDimensions(ctx, project, view);
    drawLiveWorkspaceOverlays(ctx, project, opts, view);
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
  drawObjectsFaint(ctx, project, view, opts.displayPolylineCache, opts.onRasterBitmapReady);
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
  if (opts.cncRemovalGrid != null) {
    drawCncRemoval(ctx, opts.cncRemovalGrid, view, stockMaterialKey(project));
  }
  if (opts.previewToolpath === undefined) return;
  if (
    opts.previewRouteRenderer?.(
      ctx,
      opts.previewToolpath,
      view,
      opts.scrubberT ?? 1,
      opts.previewShowTravel !== false,
      opts.previewBackgroundKey,
    ) === true
  )
    return;
  drawPreview(ctx, opts.previewToolpath, view, opts.scrubberT ?? 1, {
    showTravel: opts.previewShowTravel !== false,
    showFuture: true,
    showEndpoints: true,
  });
}

function drawLiveWorkspaceOverlays(
  ctx: CanvasRenderingContext2D,
  project: Project,
  opts: DrawOpts,
  view: ViewTransform,
): void {
  if (opts.draft !== undefined) drawDraftShape(ctx, opts.draft, view);
  if (opts.penDraft !== undefined) drawPenDraft(ctx, opts.penDraft, view);
  if (opts.selectionMarquee !== undefined) drawSelectionMarquee(ctx, opts.selectionMarquee, view);
  if (opts.measureDraft !== undefined) drawMeasurement(ctx, opts.measureDraft, view);
  if (opts.cncTabLayerColor !== undefined && opts.selectedId !== null) {
    const selected = project.scene.objects.find((object) => object.id === opts.selectedId);
    if (selected !== undefined) drawCncTabAnchors(ctx, selected, opts.cncTabLayerColor, view);
  }
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
  ctx.strokeStyle = canvasVectorDisplayColor(draft.color);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  for (const path of draft.paths) strokePolylinesBatched(ctx, draft, path.polylines, view);
  ctx.restore();
}

// The job's stock material (ADR-112), or undefined for a laser project or a
// "Custom" CNC job — both of which fall back to the original wood palette.
function stockMaterialKey(project: Project): ChiploadMaterial | undefined {
  if (project.machine?.kind !== 'cnc') return undefined;
  // CncStock.materialKey is a plain string on the model, so an unrecognised or
  // stale key from an older project file must fall back rather than index the
  // appearance table with nothing behind it.
  const key = project.machine.stock.materialKey;
  return isChiploadMaterialKey(key) ? key : undefined;
}

function liveRasterDataUrls(project: Project): Set<string> {
  const live = new Set<string>();
  for (const obj of project.scene.objects) {
    if (obj.kind === 'raster-image') live.add(rasterDisplayDataUrl(obj));
  }
  return live;
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
  displayMode: ObjectDisplayMode,
  additionalSelectedIds: ReadonlySet<string> = EMPTY_SELECTION,
  onRasterBitmapReady?: () => void,
  displayPolylineCache?: DisplayPolylineCache,
  artworkRunFocus?: ArtworkRunFocus,
): boolean {
  const layerByColor = sceneLayerVisibility.lookup(project.scene.layers);
  scheduleReliefPreviews(project.scene.objects, layerByColor, onRasterBitmapReady);
  let simplified = false;
  for (const obj of project.scene.objects) {
    ctx.save();
    if (artworkRunFocus !== undefined && !artworkRunFocus.objectIds.includes(obj.id)) {
      ctx.globalAlpha = 0.24;
    }
    const isVisible = sceneLayerVisibility.hasObject(obj, layerByColor);
    // ImportedSvg and TextObject share the same polyline shape after text renders
    // to paths — single drawing path. ADR-057: dash the jig box so it reads as a
    // placement fixture, not artwork; reset after, before the overlays below.
    ctx.setLineDash(isRegistrationBox(obj) ? [8, 5] : []);
    if (
      drawObjectPolylines(
        ctx,
        obj,
        layerByColor,
        view,
        displayPolylineCache,
        onRasterBitmapReady,
        displayMode,
      )
    ) {
      simplified = true;
    }
    ctx.setLineDash([]);
    // F.2.c: raster images render via Canvas2D drawImage rather than
    // polyline strokes. The bitmap displays at its mm-bounds; the
    // dither preview overlay is a separate render layer we can add
    // later if needed. Hiding the layer hides its bitmaps (M23) —
    // an orphan color with no layer stays visible so artwork never
    // silently disappears.
    if (obj.kind === 'raster-image' && isVisible) {
      drawRasterImage(ctx, obj, view, {
        adjustments: burnedImageAdjustments(obj, layerByColor),
        ...(onRasterBitmapReady === undefined ? {} : { onBitmapReady: onRasterBitmapReady }),
      });
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
    ctx.restore();
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
    (object) => selectedIds.has(object.id) && sceneLayerVisibility.hasObject(object, layerByColor),
  );
}

// imported-svg, text, traced-image and shape all carry the same ColoredPath[]
// shape — one resolution + one painter (object-display.ts). Dense objects are
// blitted from a cached sprite; the rest paint directly, one beginPath/stroke
// per path (per-polyline stroke() was the original post-import freeze).
function drawObjectPolylines(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layerByColor: Map<string, Layer>,
  view: ViewTransform,
  displayPolylineCache: DisplayPolylineCache | undefined,
  requestRedraw: (() => void) | undefined,
  displayMode: ObjectDisplayMode,
): boolean {
  if (!isVectorSceneObject(obj)) return false;
  const resolved = resolveObjectDisplay(obj, layerByColor, view, displayPolylineCache, displayMode);
  drawObjectDisplay(ctx, obj, resolved, view, requestRedraw);
  return resolved.isSimplified;
}

// F-A3/A6/A8 — overlay any object whose transformed bbox extends past the
