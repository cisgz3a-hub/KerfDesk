import { pointInPolygon } from '../geometry';
import type { Polyline } from '../scene';

type FinishAllowancePartBuckets = {
  readonly buckets: ReadonlyArray<ReadonlyArray<ReadonlyArray<Polyline>>>;
  readonly unassigned: ReadonlyArray<ReadonlyArray<Polyline>>;
};

/** Assign offset-derived parts to their original source-part order. */
export function bucketFinishAllowanceParts(
  sourceParts: ReadonlyArray<ReadonlyArray<Polyline>>,
  derivedParts: ReadonlyArray<ReadonlyArray<Polyline>>,
): FinishAllowancePartBuckets {
  const buckets: Array<Array<ReadonlyArray<Polyline>>> = sourceParts.map(() => []);
  const unassigned: Array<ReadonlyArray<Polyline>> = [];
  for (const part of derivedParts) {
    const owner = sourceOwnerIndex(part, sourceParts);
    if (owner < 0) unassigned.push(part);
    else buckets[owner]?.push(part);
  }
  return { buckets, unassigned };
}

function sourceOwnerIndex(
  derivedPart: ReadonlyArray<Polyline>,
  sourceParts: ReadonlyArray<ReadonlyArray<Polyline>>,
): number {
  const derivedOuter = partOuter(derivedPart);
  if (derivedOuter === undefined) return -1;
  const candidates: Array<{ readonly index: number; readonly centerDistance: number }> = [];
  sourceParts.forEach((sourcePart, index) => {
    const sourceOuter = partOuter(sourcePart);
    if (sourceOuter === undefined || !samePartRegion(sourceOuter, derivedOuter)) return;
    candidates.push({ index, centerDistance: boundsCenterDistance(sourceOuter, derivedOuter) });
  });
  candidates.sort((a, b) => a.centerDistance - b.centerDistance || a.index - b.index);
  return candidates[0]?.index ?? -1;
}

function partOuter(part: ReadonlyArray<Polyline>): Polyline | undefined {
  return [...part].reverse().find((polyline) => polyline.closed) ?? part[0];
}

function samePartRegion(source: Polyline, derived: Polyline): boolean {
  if (!source.closed || !derived.closed) return samePolyline(source, derived);
  return containsByBoundsAndProbe(source, derived) || containsByBoundsAndProbe(derived, source);
}

function samePolyline(a: Polyline, b: Polyline): boolean {
  return (
    a.closed === b.closed &&
    a.points.length === b.points.length &&
    a.points.every((point, index) => {
      const other = b.points[index];
      return other !== undefined && point.x === other.x && point.y === other.y;
    })
  );
}

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function containsByBoundsAndProbe(outer: Polyline, inner: Polyline): boolean {
  const outerBounds = polylineBounds(outer);
  const innerBounds = polylineBounds(inner);
  const probe = inner.points[0];
  return (
    probe !== undefined &&
    outerBounds.minX <= innerBounds.minX &&
    outerBounds.minY <= innerBounds.minY &&
    outerBounds.maxX >= innerBounds.maxX &&
    outerBounds.maxY >= innerBounds.maxY &&
    pointInPolygon(probe, outer.points)
  );
}

function boundsCenterDistance(a: Polyline, b: Polyline): number {
  const first = polylineBounds(a);
  const second = polylineBounds(b);
  return Math.hypot(
    first.minX + first.maxX - second.minX - second.maxX,
    first.minY + first.maxY - second.minY - second.maxY,
  );
}

function polylineBounds(polyline: Polyline): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
