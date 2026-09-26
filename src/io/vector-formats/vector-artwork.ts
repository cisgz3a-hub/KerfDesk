// Shared artwork model for the PDF, EPS and GeoJSON writers (ADR-444).
//
// Every writer receives the same painted items: world millimetres in the
// scene frame (Y down), one item per artwork path, each either filled (closed
// contours, with its fill rule) or stroked (open contours, and every contour
// of a line/centreline layer). Items stay separate so two overlapping
// objects of the same colour never cancel under one even-odd fill.
//
// Placement: each writer maps the scene frame to a Y-up page whose lower-left
// corner is (0, 0). The grid page is the exact artwork extent by default, or
// a caller's rectangle (the traced image page), and coordinates are snapped
// to a power-of-ten millimetre grid (core/vector-export/decimal-grid). PDF
// and EPS paint on a slightly larger page (paintedPageBox) so the stroke
// width fits and no side is below the 3 pt minimum; GeoJSON has no ink and
// uses the grid page itself.

import {
  curveSubpathBounds,
  pathUsesOperation,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { err, ok, type Result } from '../../core/result';
import type { TracedLayer } from '../../core/trace/batch-trace-svg';
import { transformCurveSubpathExact } from '../../core/vector-export/affine-curves';
import {
  DEFAULT_EXPORT_PRECISION_MM,
  decimalGridAtMost,
  formatGridIndex,
  gridIndex,
  outwardGridIndices,
  type DecimalGrid,
} from '../../core/vector-export/decimal-grid';
import { arcToCubics } from '../svg/flatten-curves';
import { filledCurvesKept } from './collapsed-ring-subtrees';
import { svgObjectMatrix } from '../svg/export-svg-paths';

export type VectorPaint = 'fill' | 'stroke';
export type VectorFillRule = 'evenodd' | 'nonzero';

export type VectorPaintItem = {
  /** `#rrggbb`. */
  readonly color: string;
  readonly paint: VectorPaint;
  readonly fillRule: VectorFillRule;
  /** World millimetres, scene frame (Y down). */
  readonly curves: ReadonlyArray<CurveSubpath>;
};

/** A rectangle in the scene frame (Y down), millimetres. */
export type VectorPageRect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type VectorWriteOptions = {
  /** Coordinate grid in mm; each point moves by at most half a grid diagonal. */
  readonly precisionMm?: number;
  /** Page rectangle in the scene frame. Default: the exact artwork extent. */
  readonly page?: VectorPageRect;
};

/** Stroke width for stroked items: a 0.1 mm hairline, as the SVG exporter draws. */
export const VECTOR_STROKE_WIDTH_MM = 0.1;

/** One drawing command on the page grid (integer grid indices, Y up). */
export type GridCommand =
  | { readonly op: 'move'; readonly p: GridPoint }
  | { readonly op: 'line'; readonly p: GridPoint }
  | { readonly op: 'cubic'; readonly c1: GridPoint; readonly c2: GridPoint; readonly p: GridPoint }
  | { readonly op: 'close' };
export type GridPoint = { readonly x: number; readonly y: number };

export type PreparedPage = {
  readonly grid: DecimalGrid;
  /** Page size in grid steps; the page spans [0, width] x [0, height]. */
  readonly widthSteps: number;
  readonly heightSteps: number;
  /** Scene point (mm, Y down) → page grid indices (Y up). */
  readonly toGrid: (point: Vec2) => GridPoint;
};

/**
 * Page placement shared by every writer. The page is rounded outward to the
 * grid, so it always contains the artwork (or the caller's rectangle).
 */
export function preparePage(
  items: ReadonlyArray<VectorPaintItem>,
  options: VectorWriteOptions,
): PreparedPage {
  const grid = decimalGridAtMost(options.precisionMm ?? DEFAULT_EXPORT_PRECISION_MM);
  const rect = options.page ?? artworkExtent(items);
  if (rect === null) throw new Error('There is no vector geometry to write.');
  const width = outwardGridIndices(0, rect.maxX - rect.minX, grid).hi;
  const height = outwardGridIndices(0, rect.maxY - rect.minY, grid).hi;
  return {
    grid,
    widthSteps: Math.max(width, 1),
    heightSteps: Math.max(height, 1),
    toGrid: (point) => ({
      x: gridIndex(point.x - rect.minX, grid),
      y: gridIndex(rect.maxY - point.y, grid),
    }),
  };
}

/** Exact extent of every drawn curve (derivative roots and arc extrema), or null. */
export function artworkExtent(items: ReadonlyArray<VectorPaintItem>): VectorPageRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    for (const curve of item.curves) {
      if (curve.segments.length === 0) continue;
      const b = curveSubpathBounds(curve);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Lines and cubics on the page grid. Elliptical arcs become cubics (at most a
 * quarter turn each); snapping every control point moves each point of a
 * Bezier by at most the largest control-point move, half a grid diagonal.
 * A zero-radius arc is a line and a zero-length arc is dropped (SVG 1.1 F.6.2).
 */
export function gridCommands(curve: CurveSubpath, page: PreparedPage): GridCommand[] {
  const commands: GridCommand[] = [{ op: 'move', p: page.toGrid(curve.start) }];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'line') {
      commands.push({ op: 'line', p: page.toGrid(segment.to) });
    } else if (segment.kind === 'cubic') {
      commands.push({
        op: 'cubic',
        c1: page.toGrid(segment.control1),
        c2: page.toGrid(segment.control2),
        p: page.toGrid(segment.to),
      });
    } else if (from.x === segment.to.x && from.y === segment.to.y) {
      // Zero-length arc: omitted.
    } else if (!(segment.radiusX !== 0 && segment.radiusY !== 0)) {
      commands.push({ op: 'line', p: page.toGrid(segment.to) });
    } else {
      const cubics = arcToCubics(
        from,
        segment.to,
        Math.abs(segment.radiusX),
        Math.abs(segment.radiusY),
        {
          rx: Math.abs(segment.radiusX),
          ry: Math.abs(segment.radiusY),
          xAxisRotationDeg: segment.rotationDeg,
          largeArc: segment.largeArc,
          sweep: segment.sweep,
        },
      );
      for (const [index, cubic] of cubics.entries()) {
        commands.push({
          op: 'cubic',
          c1: page.toGrid(cubic.p1),
          c2: page.toGrid(cubic.p2),
          // The last piece ends exactly on the segment's endpoint.
          p: page.toGrid(index === cubics.length - 1 ? segment.to : cubic.p3),
        });
      }
    }
    from = segment.to;
  }
  if (curve.closed) commands.push({ op: 'close' });
  return commands;
}

/**
 * One painted item as PDF/PostScript path construction commands on the page
 * grid, one command per string ("x y m", "x1 y1 x2 y2 x y c", "h"). PDF uses
 * these operators natively; the EPS prolog binds the same names.
 */
export function itemPathCommands(item: VectorPaintItem, page: PreparedPage): string[] {
  const n = (index: number): string => formatGridIndex(index, page.grid);
  const curves = item.curves.filter((curve) => curve.segments.length > 0);
  const paths = curves.map((curve) => gridCommands(curve, page));
  // A filled contour whose control points collapse onto one grid line paints
  // nothing; it is left out together with every contour nested in it, so none
  // of them paints with the opposite fill (ADR-444 Amendment 1).
  const kept = item.paint === 'fill' ? filledCurvesKept(curves, paths.map(commandPoints)) : null;
  const out: string[] = [];
  for (const [index, commands] of paths.entries()) {
    if (kept !== null && kept[index] !== true) continue;
    for (const command of commands) {
      if (command.op === 'close') out.push('h');
      else if (command.op === 'cubic') {
        const { c1, c2, p } = command;
        out.push([c1.x, c1.y, c2.x, c2.y, p.x, p.y].map(n).join(' ') + ' c');
      } else
        out.push(n(command.p.x) + ' ' + n(command.p.y) + (command.op === 'move' ? ' m' : ' l'));
    }
  }
  return out;
}

function commandPoints(commands: ReadonlyArray<GridCommand>): GridPoint[] {
  return commands.flatMap((command) =>
    command.op === 'close'
      ? []
      : command.op === 'cubic'
        ? [command.c1, command.c2, command.p]
        : [command.p],
  );
}

/** Points per millimetre. */
export const PT_PER_MM = 72 / 25.4;

/** Grid steps (mm) → points, rounded up to 0.0001 pt so the page contains the grid extent. */
export function pointsOutward(steps: number, grid: DecimalGrid): number {
  const mm = Number(formatGridIndex(steps, grid));
  return Math.ceil(mm * PT_PER_MM * 1e4 - 1e-6) / 1e4;
}

/** PDF 1.4 Reference, Appendix C: the smallest page side, in default units (points). */
export const MIN_PAGE_SIDE_PT = 3;

/**
 * The painted page in points around the grid page: the artwork sits at
 * (offsetXPt, offsetYPt). On the default (artwork-extent) page, stroked items
 * add half the stroke width on every side so hairlines on the extent edge are
 * not clipped; any side shorter than 3 pt grows to 3 pt, centred. A caller's
 * page (the traced image) is kept as given apart from that minimum.
 */
export type PaintedPageBox = {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly offsetXPt: number;
  readonly offsetYPt: number;
};

export function paintedPageBox(
  items: ReadonlyArray<VectorPaintItem>,
  options: VectorWriteOptions,
  page: PreparedPage,
): PaintedPageBox {
  // Work in integer 1/10000 pt so sums stay exact.
  const unit = 1e4;
  const margin =
    options.page === undefined && items.some((item) => item.paint === 'stroke')
      ? Math.ceil((VECTOR_STROKE_WIDTH_MM / 2) * PT_PER_MM * unit - 1e-6)
      : 0;
  const minimum = MIN_PAGE_SIDE_PT * unit;
  const side = (steps: number): { size: number; offset: number } => {
    const art = Math.round(pointsOutward(steps, page.grid) * unit);
    const size = art + 2 * margin;
    if (size >= minimum) return { size, offset: margin };
    return { size: minimum, offset: Math.floor((minimum - art) / 2) };
  };
  const x = side(page.widthSteps);
  const y = side(page.heightSteps);
  return {
    widthPt: x.size / unit,
    heightPt: y.size / unit,
    offsetXPt: x.offset / unit,
    offsetYPt: y.offset / unit,
  };
}

export function pointText(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** `#rrggbb` → [r, g, b] in 0..255; anything else is black. */
export function rgbBytes(color: string): readonly [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (match === null) return [0, 0, 0];
  const value = Number.parseInt(match[1] as string, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A colour component 0..255 as a 0..1 operand with at most four decimals. */
export function unitColorText(byte: number): string {
  const text = (byte / 255).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return text === '' ? '0' : text;
}

// ---------------------------------------------------------------------------
// Sources

type VectorObject = Extract<SceneObject, { readonly paths: readonly ColoredPath[] }>;

export type SceneVectorArtwork = {
  readonly items: ReadonlyArray<VectorPaintItem>;
  readonly objectCount: number;
  /** Bitmaps and reliefs have no vector form and are left out. */
  readonly omittedObjectCount: number;
};

const VECTOR_ONLY_MESSAGE =
  'This format holds vector artwork only. Select vector, text or traced artwork.';

/**
 * Scene artwork (or a selection) as painted items. A path is filled when its
 * layer's effective operation fills, as the SVG exporter decides; open
 * contours of a filled path are stroked.
 */
export function sceneVectorArtwork(
  project: Project,
  selectedIds?: readonly string[],
): Result<SceneVectorArtwork, string> {
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object) => selected === null || selected.has(object.id),
  );
  if (objects.length === 0) return err('There is no artwork to export.');
  const vectors = objects.filter(isVectorArtworkObject);
  if (vectors.length === 0) return err(VECTOR_ONLY_MESSAGE);
  const items: VectorPaintItem[] = [];
  for (const object of vectors) {
    const matrix = svgObjectMatrix(object.transform);
    for (const path of object.paths) {
      const curves = (path.curves ?? path.polylines.map(polylineToCurveSubpath))
        .filter((curve) => curve.segments.length > 0)
        .map((curve) => transformCurveSubpathExact(curve, matrix));
      const operation = project.scene.layers.find((layer) =>
        pathUsesOperation(object, path, layer),
      );
      const fill =
        operation !== undefined && effectiveOperationForObject(operation, object).mode === 'fill';
      const fillRule: VectorFillRule =
        path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd');
      pushSplit(items, path.color, fill, fillRule, curves);
    }
  }
  if (items.length === 0) return err('There is no vector geometry to write.');
  return ok({
    items,
    objectCount: vectors.length,
    omittedObjectCount: objects.length - vectors.length,
  });
}

/** Whether the scene (or selection) holds anything a vector format can carry. */
export function hasVectorArtwork(project: Project, selectedIds?: readonly string[]): boolean {
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  return project.scene.objects.some(
    (object) => (selected === null || selected.has(object.id)) && isVectorArtworkObject(object),
  );
}

export function isVectorArtworkObject(object: SceneObject): object is VectorObject {
  return object.kind !== 'raster-image' && object.kind !== 'relief' && 'paths' in object;
}

/**
 * Multi-File Trace layers as painted items: closed contours fill even-odd
 * (the trace's own rule) except in Centerline, where every contour is a
 * stroke, as the traced SVG draws them.
 */
export function tracedLayerItems(
  layers: ReadonlyArray<TracedLayer>,
  strokeOnly: boolean,
): VectorPaintItem[] {
  const items: VectorPaintItem[] = [];
  for (const layer of layers) {
    const curves = layer.curves.filter((curve) => curve.segments.length > 0);
    pushSplit(items, layer.color, !strokeOnly, 'evenodd', curves);
  }
  return items;
}

function pushSplit(
  items: VectorPaintItem[],
  color: string,
  fill: boolean,
  fillRule: VectorFillRule,
  curves: ReadonlyArray<CurveSubpath>,
): void {
  const normalized = color.toLowerCase();
  const filled = fill ? curves.filter((curve) => curve.closed) : [];
  const stroked = fill ? curves.filter((curve) => !curve.closed) : curves;
  if (filled.length > 0) items.push({ color: normalized, paint: 'fill', fillRule, curves: filled });
  if (stroked.length > 0) {
    items.push({ color: normalized, paint: 'stroke', fillRule, curves: stroked });
  }
}
