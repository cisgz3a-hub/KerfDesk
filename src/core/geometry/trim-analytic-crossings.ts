// Mixed line/curve pairs are solved on canonical geometry. Curve/curve and
// self-intersections deliberately retain Trim's existing chord-grid behaviour.
import { applyTransform, type Bounds, type PathSegment, type Vec2 } from '../scene';
import { curveSubpathBounds } from '../scene/curve-path';
import { transformedBounds } from '../scene/hit-test';
import { segmentRayParametricContacts, supportsParametricRayContacts } from './extend-ray';
import type { TrimContour } from './trim-contours';
import {
  createTrimBoundsIndex,
  forEachTrimBoundsOverlap,
  type TrimBoundsIndex,
} from './trim-bounds-index';
import type { TrimCrossing } from './trim-crossings';
import { segmentPoint } from './trim-curve-split';

const TOUCH_MM = 1e-6;
type SegmentEntry = {
  readonly index: number;
  readonly from: Vec2;
  readonly segment: PathSegment;
  readonly bounds: Bounds;
};
type IndexedSegments = {
  readonly lines: TrimBoundsIndex<SegmentEntry> | null;
  readonly curves: TrimBoundsIndex<SegmentEntry> | null;
};
const segments = new WeakMap<TrimContour, ReadonlyArray<SegmentEntry>>();
const indexes = new WeakMap<TrimContour, IndexedSegments>();

export function collectAnalyticCrossings(
  contour: TrimContour,
  outline: TrimContour,
  found: TrimCrossing[],
): void {
  const boundaries = indexesOf(outline);
  for (const source of segmentsOf(contour)) {
    const index = source.segment.kind === 'line' ? boundaries.curves : boundaries.lines;
    forEachTrimBoundsOverlap(index, source.bounds, TOUCH_MM, (boundary) => {
      collectPair(contour, source, outline, boundary, found);
    });
  }
}

function collectPair(
  contour: TrimContour,
  source: SegmentEntry,
  outline: TrimContour,
  boundary: SegmentEntry,
  found: TrimCrossing[],
): void {
  const sourceIsLine = source.segment.kind === 'line';
  const line = sourceIsLine ? source : boundary;
  const lineContour = sourceIsLine ? contour : outline;
  const curve = sourceIsLine ? boundary : source;
  const curveContour = sourceIsLine ? outline : contour;
  const a = applyTransform(line.from, lineContour.transform);
  const b = applyTransform(line.segment.to, lineContour.transform);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= TOUCH_MM) return;
  const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  for (const hit of segmentRayParametricContacts(
    a,
    direction,
    curve.from,
    curve.segment,
    curveContour.transform,
  )) {
    if (hit.overlap || hit.parameter === null || hit.distance > length + TOUCH_MM) continue;
    const lineT = Math.min(1, hit.distance / length);
    const p = source.index + (sourceIsLine ? lineT : hit.parameter);
    found.push({
      p,
      chord: chordAt(contour, p),
      exact: true,
      point: sourceIsLine
        ? { x: a.x + direction.x * lineT * length, y: a.y + direction.y * lineT * length }
        : applyTransform(
            segmentPoint(curve.from, curve.segment, hit.parameter),
            curveContour.transform,
          ),
      edgeStart: applyTransform(boundary.from, outline.transform),
      edgeEnd: applyTransform(boundary.segment.to, outline.transform),
    });
  }
}

/** Suppress approximate duplicate hits for pairs already handled analytically. */
export function analyticChordPair(
  contour: TrimContour,
  chord: number,
  outline: TrimContour,
  edge: number,
): boolean {
  const a = chordSegment(contour, chord);
  const b = chordSegment(outline, edge);
  return (
    mixedKinds(a?.segment, b?.segment) && supportsSegment(contour, a) && supportsSegment(outline, b)
  );
}

function chordSegment(contour: TrimContour, chord: number): SegmentEntry | undefined {
  const [low, high] = contour.chordParams[chord] ?? [0, 0];
  return segmentsOf(contour)[Math.floor((low + high) / 2)];
}

const supportedSegments = new WeakMap<TrimContour, Map<number, boolean>>();
function supportsSegment(contour: TrimContour, entry: SegmentEntry | undefined): boolean {
  if (entry === undefined) return false;
  if (entry.segment.kind !== 'elliptical-arc') return true;
  let cached = supportedSegments.get(contour);
  if (cached === undefined) {
    cached = new Map();
    supportedSegments.set(contour, cached);
  }
  let supported = cached.get(entry.index);
  if (supported === undefined) {
    supported = supportsParametricRayContacts(entry.from, entry.segment, contour.transform);
    cached.set(entry.index, supported);
  }
  return supported;
}

function mixedKinds(a: PathSegment | undefined, b: PathSegment | undefined): boolean {
  return a !== undefined && b !== undefined && (a.kind === 'line') !== (b.kind === 'line');
}

function segmentsOf(contour: TrimContour): ReadonlyArray<SegmentEntry> {
  const cached = segments.get(contour);
  if (cached !== undefined) return cached;
  let from = contour.segments.start;
  const entries = contour.segments.segments.map((segment, index) => {
    const localBounds = curveSubpathBounds({ start: from, segments: [segment], closed: false });
    const entry = {
      from,
      segment,
      index,
      bounds: transformedBounds(localBounds, contour.transform),
    };
    from = segment.to;
    return entry;
  });
  segments.set(contour, entries);
  return entries;
}

function indexesOf(contour: TrimContour): IndexedSegments {
  const cached = indexes.get(contour);
  if (cached !== undefined) return cached;
  const entries = segmentsOf(contour);
  const indexed = {
    lines: createTrimBoundsIndex(entries.filter((entry) => entry.segment.kind === 'line')),
    curves: createTrimBoundsIndex(entries.filter((entry) => entry.segment.kind !== 'line')),
  };
  indexes.set(contour, indexed);
  return indexed;
}

function chordAt(contour: TrimContour, p: number): number {
  let low = 0;
  let high = contour.chordParams.length;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((contour.chordParams[middle] as readonly [number, number])[0] <= p) low = middle;
    else high = middle;
  }
  return low;
}
