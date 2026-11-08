// Resolves what a vector object's paths look like on the canvas (display
// polylines + paint per path) separately from painting them, so the same
// resolution can be painted straight onto the workspace, into a cached sprite
// (artwork-sprite-cache.ts), or as the faint Preview underlay.

import {
  applyTransform,
  flattenColoredPathCurves,
  isRegistrationBox,
  sceneLayerVisibility,
  type AABB,
  type ColoredPath,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { pathFillOperations, pathStylingOperation } from '../../core/scene/fill-operations';
import { canvasTheme } from '../theme/canvas-theme';
import { canvasVectorDisplayColor } from '../theme/canvas-vector-color';
import { drawArtworkSprite, SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import {
  artworkStrokeWidthPx,
  countPolylineSegments,
  hairlineFrameWidthPx,
} from './draw-complexity';
import {
  buildDisplayPolylines,
  buildFillDisplayPolylines,
  displayCurveToleranceMm,
  type DisplayPolylineCache,
  type DisplayPolylines,
} from './display-polylines';
import { fillClosedPolylinesBatched, strokePolylinesBatched } from './draw-vector-strokes';
import type { ViewTransform } from './view-transform';

export type VectorSceneObject = Extract<
  SceneObject,
  { readonly paths: ReadonlyArray<ColoredPath> }
>;

export type PathPaint =
  | { readonly kind: 'stroke'; readonly color: string; readonly output: boolean }
  | {
      readonly kind: 'fill';
      readonly color: string;
      readonly output: boolean;
      readonly fillRule: CanvasFillRule;
    };

export type PathDisplay = {
  readonly display: DisplayPolylines;
  readonly paint: PathPaint;
  /** The operation that styles this path; null for a colour no operation owns. */
  readonly operationId: string | null;
  /** The scene path drawn, for callers that need every operation bound to it. */
  readonly path: ColoredPath;
  /** The path's paint under every visible Fill operation that burns it (ADR-683). */
  readonly fillOperations: ReadonlyArray<FillOperationPaint>;
  /** The contours and rule its Fill operations burn, even when it is drawn as a stroke. */
  readonly fillDisplay: DisplayPolylines;
  readonly fillRule: CanvasFillRule;
};

export type FillOperationPaint = {
  readonly operationId: string;
  readonly color: string;
  readonly output: boolean;
};

const NO_FILL_OPERATIONS: ReadonlyArray<FillOperationPaint> = [];

export type ObjectDisplay = {
  readonly paths: ReadonlyArray<PathDisplay>;
  /** Segments the canvas actually draws for this object (after display sampling). */
  readonly displaySegmentCount: number;
  readonly isSimplified: boolean;
  /** Changes whenever visible geometry, resolved paint or width draws differently. */
  readonly styleKey: string;
};

// 'design' is the ordinary workspace (fills fill, orphan colours stroke as
// themselves); 'wireframe' is the same but Fill artwork is outlined instead of
// filled (ADR-410); 'faint' is the Preview underlay, which strokes everything
// in its operation colour and never fills.
export type ObjectDisplayMode = 'design' | 'wireframe' | 'faint';

// 'operation' paints each path in its operation colour. 'ink' paints artwork
// that an operation owns in plain artwork ink, so the workspace reads as the
// design itself; the colours appear on hover or while Alt is held (ADR-620).
// The faint Preview underlay always uses operation colours.
export type ArtworkPalette = 'operation' | 'ink';

export function isVectorSceneObject(obj: SceneObject): obj is VectorSceneObject {
  return (
    obj.kind === 'imported-svg' ||
    obj.kind === 'text' ||
    obj.kind === 'traced-image' ||
    obj.kind === 'shape'
  );
}

export function resolveObjectDisplay(
  obj: VectorSceneObject,
  layerByColor: ReadonlyMap<string, Layer>,
  view: ViewTransform,
  cache: DisplayPolylineCache | undefined,
  mode: ObjectDisplayMode,
  palette: ArtworkPalette = 'operation',
): ObjectDisplay {
  const paths: PathDisplay[] = [];
  let displaySegmentCount = 0;
  let isSimplified = false;
  const styleParts: string[] = [];
  for (const [pathIndex, path] of obj.paths.entries()) {
    const resolution = sceneLayerVisibility.resolvePath(obj, path, layerByColor);
    if (!resolution.visible) continue;
    const operation = pathStylingOperation(obj, path, layerByColor);
    const paint = resolvePaint(obj, path, operation, mode, palette);
    const display = displayPathFor(path, obj, view, cache, paint.kind === 'fill');
    const fillOperations =
      mode === 'design'
        ? fillOperationPaints(obj, path, layerByColor, palette)
        : NO_FILL_OPERATIONS;
    displaySegmentCount += countPolylineSegments(display.polylines);
    isSimplified ||= display.isSimplified;
    // The sprite's geometry identity is the entire immutable paths array.
    // Equal ink styles must still distinguish which paths are visible.
    styleParts.push(`${pathIndex}:${paintKey(paint)}`);
    paths.push({
      display,
      paint,
      operationId: operation?.id ?? null,
      path,
      fillOperations,
      fillDisplay:
        paint.kind === 'fill' || fillOperations.length === 0
          ? display
          : displayPathFor(path, obj, view, cache, true),
      fillRule: fillRuleOf(obj, path),
    });
  }
  return {
    paths,
    displaySegmentCount,
    isSimplified,
    styleKey: `${mode}|${artworkStrokeWidthPx(displaySegmentCount, true)}|${styleParts.join(';')}`,
  };
}

/**
 * Draw a resolved object: dense objects come from their cached sprite
 * (artwork-sprite-cache.ts), everything else is painted directly. Both paths
 * run the same per-path painter, so a sprite shows exactly what a direct
 * paint would. `hairline` thins a direct paint on a moving frame; a sprite
 * keeps its own width, because a blit costs the same either way.
 */
export function drawObjectDisplay(
  ctx: CanvasRenderingContext2D,
  obj: VectorSceneObject,
  resolved: ObjectDisplay,
  view: ViewTransform,
  requestRedraw?: () => void,
  hairline = false,
): void {
  if (
    resolved.displaySegmentCount >= SPRITE_MIN_DISPLAY_SEGMENTS &&
    !isRegistrationBox(obj) &&
    drawArtworkSprite({
      ctx,
      key: obj.paths,
      transform: obj.transform,
      view,
      styleKey: resolved.styleKey,
      measure: () => measureObjectDisplayBounds(obj, resolved),
      paint: (spriteCtx, spriteView) => paintObjectDisplay(spriteCtx, obj, resolved, spriteView),
      requestRedraw,
    })
  ) {
    return;
  }
  paintObjectDisplay(ctx, obj, resolved, view, hairline);
}

/** Paint a resolved object exactly as the workspace draws it, path by path. */
export function paintObjectDisplay(
  ctx: CanvasRenderingContext2D,
  obj: VectorSceneObject,
  resolved: ObjectDisplay,
  view: ViewTransform,
  hairline = false,
): void {
  for (const { display, paint } of resolved.paths) {
    const width = artworkStrokeWidthPx(resolved.displaySegmentCount, paint.output);
    const widthPx = hairline ? hairlineFrameWidthPx(width) : width;
    if (paint.kind === 'fill') {
      paintFilledGeometry(ctx, obj, display, paint, widthPx, view);
      continue;
    }
    ctx.strokeStyle = paint.color;
    ctx.lineWidth = widthPx;
    strokePolylinesBatched(ctx, obj, display.polylines, view);
  }
}

/**
 * Extent of the resolved display geometry in object space after the object's
 * scale/mirror/rotate but before its translation, so a sprite measured here
 * stays valid while the object is moved. O(points): callers cache the result.
 */
export function measureObjectDisplayBounds(obj: VectorSceneObject, resolved: ObjectDisplay): AABB {
  const linear = { ...obj.transform, x: 0, y: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { display } of resolved.paths) {
    for (const polyline of display.polylines) {
      for (const raw of polyline.points) {
        const point = applyTransform(raw, linear);
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function resolvePaint(
  obj: VectorSceneObject,
  path: ColoredPath,
  layer: Layer | undefined,
  mode: ObjectDisplayMode,
  palette: ArtworkPalette,
): PathPaint {
  if (mode === 'faint') {
    return {
      kind: 'stroke',
      color: canvasVectorDisplayColor(layer?.color ?? path.color),
      output: layer?.output !== false,
    };
  }
  if (layer === undefined) {
    return { kind: 'stroke', color: canvasVectorDisplayColor(path.color), output: true };
  }
  const effective = effectiveOperationForObject(layer, obj);
  const color = palette === 'ink' ? canvasTheme.artworkInk : canvasVectorDisplayColor(layer.color);
  if (effective.mode === 'fill' && mode !== 'wireframe') {
    return {
      kind: 'fill',
      color,
      output: effective.output,
      fillRule: fillRuleOf(obj, path),
    };
  }
  return { kind: 'stroke', color, output: effective.output };
}

function fillRuleOf(obj: VectorSceneObject, path: ColoredPath): CanvasFillRule {
  return path.fillRule ?? (obj.kind === 'text' ? 'nonzero' : 'evenodd');
}

function fillOperationPaints(
  obj: VectorSceneObject,
  path: ColoredPath,
  layerByColor: ReadonlyMap<string, Layer>,
  palette: ArtworkPalette,
): ReadonlyArray<FillOperationPaint> {
  return pathFillOperations(obj, path, layerByColor).map(({ operation, output }) => ({
    operationId: operation.id,
    color: palette === 'ink' ? canvasTheme.artworkInk : canvasVectorDisplayColor(operation.color),
    output,
  }));
}

function paintKey(paint: PathPaint): string {
  return paint.kind === 'fill'
    ? `f:${paint.color}:${paint.output ? 1 : 0}:${paint.fillRule}`
    : `s:${paint.color}:${paint.output ? 1 : 0}`;
}

function paintFilledGeometry(
  ctx: CanvasRenderingContext2D,
  obj: VectorSceneObject,
  display: DisplayPolylines,
  paint: Extract<PathPaint, { kind: 'fill' }>,
  widthPx: number,
  view: ViewTransform,
): void {
  const polylines = display.polylines;
  if (polylines.some((polyline) => polyline.closed)) {
    ctx.fillStyle = paint.color;
    fillClosedPolylinesBatched(ctx, obj, polylines, view, paint.fillRule);
  }
  const open = polylines.filter((polyline) => !polyline.closed);
  if (open.length === 0) return;
  ctx.strokeStyle = paint.color;
  ctx.lineWidth = widthPx;
  strokePolylinesBatched(ctx, obj, open, view);
}

/**
 * The only part of the view an object's resolved display depends on: its
 * curve flattening tolerance, bucketed by powers of two, so a wheel zoom
 * reuses the cached flattening for about seven notches instead of flattening
 * every curve on each one. A pan leaves it unchanged.
 */
export function objectDisplayToleranceMm(object: SceneObject, view: ViewTransform): number {
  const objectScale = Math.max(
    Math.abs(object.transform.scaleX),
    Math.abs(object.transform.scaleY),
  );
  return displayCurveToleranceMm(view.scale * objectScale);
}

function displayPathFor(
  path: ColoredPath,
  object: SceneObject,
  view: ViewTransform,
  cache: DisplayPolylineCache | undefined,
  fill: boolean,
): DisplayPolylines {
  const toleranceMm = objectDisplayToleranceMm(object, view);
  if (cache !== undefined) {
    return fill ? cache.getFillPath(path, toleranceMm) : cache.getPath(path, toleranceMm);
  }
  const flattened = flattenColoredPathCurves(path, { toleranceMm });
  const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
  return fill ? buildFillDisplayPolylines(polylines) : buildDisplayPolylines(polylines);
}
