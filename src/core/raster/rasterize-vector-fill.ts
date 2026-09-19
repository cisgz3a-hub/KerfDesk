import { isClosedEnough, type Bounds, type Polyline, type Vec2 } from '../scene';

export type VectorFillPath = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly fillRule: 'evenodd' | 'nonzero';
};
export type VectorFillObject = { readonly paths: ReadonlyArray<VectorFillPath> };
// Paths union inside an object; objects interact even-odd inside one operation.
// Independent operation groups paint into the same grid without cancelling.
export type VectorFillGroup = { readonly objects: ReadonlyArray<VectorFillObject> };

type FillGrid = {
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly ink: number;
};
type PixelPath = {
  readonly contours: ReadonlyArray<ReadonlyArray<Vec2>>;
  readonly fillRule: VectorFillPath['fillRule'];
};
type Crossing = { readonly x: number; readonly delta: number };
type Span = { readonly start: number; readonly end: number };
const SCANLINE_EPS = 1e-9;

/** Resolve fill semantics on each scanline without polygon normalization.
 * Memory is bounded by source vertices and one row's crossings/spans; no
 * intersection polygons, quantization grid, or extra full-image buffers.
 */
export function fillVectorGroups(
  grid: FillGrid,
  groups: ReadonlyArray<VectorFillGroup>,
  bounds: Bounds,
  scaleX: number,
  scaleY: number,
): void {
  for (const group of groups) {
    const objects = group.objects
      .map((object) =>
        object.paths
          .map((path) => pixelPath(path, bounds, scaleX, scaleY))
          .filter((path) => path.contours.length > 0),
      )
      .filter((paths) => paths.length > 0);
    if (objects.length === 0) continue;
    for (let y = 0; y < grid.height; y += 1) {
      const objectSpans = objects.flatMap((paths) => spansForObject(paths, y + 0.5));
      const spans = objects.length === 1 ? objectSpans : combineSpans(objectSpans, 'evenodd');
      for (const span of spans) fillSpan(grid, y, span);
    }
  }
}

function pixelPath(
  path: VectorFillPath,
  bounds: Bounds,
  scaleX: number,
  scaleY: number,
): PixelPath {
  return {
    fillRule: path.fillRule,
    contours: path.polylines.filter(isClosedEnough).map((polyline) =>
      polyline.points.map((point) => ({
        x: (point.x - bounds.minX) * scaleX,
        y: (point.y - bounds.minY) * scaleY,
      })),
    ),
  };
}

function spansForObject(paths: ReadonlyArray<PixelPath>, y: number): Span[] {
  const spans = paths.flatMap((path) => sweepCrossings(crossingsAtY(path, y), path.fillRule));
  return paths.length === 1 ? spans : combineSpans(spans, 'nonzero');
}

function crossingsAtY(path: PixelPath, y: number): Crossing[] {
  const crossings: Crossing[] = [];
  for (const points of path.contours) {
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
      const dy = b.y - a.y;
      if (Math.abs(dy) < SCANLINE_EPS) continue;
      const x = a.x + ((y - a.y) / dy) * (b.x - a.x);
      if (Number.isFinite(x)) crossings.push({ x, delta: dy > 0 ? 1 : -1 });
    }
  }
  return crossings;
}

function combineSpans(spans: ReadonlyArray<Span>, fillRule: VectorFillPath['fillRule']): Span[] {
  const crossings: Crossing[] = [];
  for (const span of spans) {
    crossings.push({ x: span.start, delta: 1 }, { x: span.end, delta: -1 });
  }
  return sweepCrossings(crossings, fillRule);
}

function sweepCrossings(crossings: Crossing[], fillRule: VectorFillPath['fillRule']): Span[] {
  crossings.sort((a, b) => a.x - b.x);
  const spans: Span[] = [];
  let winding = 0;
  let start = 0;
  for (let index = 0; index < crossings.length; ) {
    const crossing = crossings[index];
    if (crossing === undefined) break;
    const wasInside = isInside(winding, fillRule);
    const x = crossing.x;
    // Aggregate coincident crossings so shared vertices and touching spans
    // do not create zero-width or duplicate ink intervals.
    while (crossings[index]?.x === x) {
      winding += crossings[index]?.delta ?? 0;
      index += 1;
    }
    const inside = isInside(winding, fillRule);
    if (!wasInside && inside) start = x;
    if (wasInside && !inside) spans.push({ start, end: x });
  }
  return spans;
}

function isInside(winding: number, fillRule: VectorFillPath['fillRule']): boolean {
  return fillRule === 'nonzero' ? winding !== 0 : winding % 2 !== 0;
}

function fillSpan(grid: FillGrid, y: number, span: Span): void {
  const xStart = Math.max(0, Math.ceil(span.start - 0.5));
  const xEnd = Math.min(grid.width - 1, Math.ceil(span.end - 0.5) - 1);
  const rowBase = y * grid.width;
  for (let x = xStart; x <= xEnd; x += 1) grid.luma[rowBase + x] = grid.ink;
}
