// Text render results return from the text worker as packed geometry
// (ADR-624, after ADR-346 and ADR-609).
//
// A paragraph of text is hundreds of thousands of {x, y} points. Structured
// cloning that reply cost the UI thread about as long as laying the text out
// (83 ms for 450 characters of Roboto, 374 ms in Great Vibes), because the
// receiving thread rebuilds every object while it deserializes. The worker
// instead sends each path's vertices and curve segments in transferred typed
// arrays, and this thread rebuilds them in tight loops.
//
// The rebuilt result must equal the one renderTextGeometry returns on this
// thread, key order included. The worker therefore packs a path only when it
// has exactly the shape the unpacker rebuilds: the path ends in `polylines`
// (then `curves`), every polyline is {points, closed}, every curve
// {start, segments, closed}, every segment a line {kind, to} or a cubic
// {kind, control1, control2, to}, and every point {x, y}. Any other path
// travels unchanged inside the ordinary clone.

import type { ColoredPath, CurveSubpath, PathSegment, Polyline, Vec2 } from '../../core/scene';
import type { TextRenderResult } from '../../core/text/text-to-polylines';
import {
  packColoredPathMessage,
  unpackColoredPath,
  type PackedColoredPath,
} from '../packed-project-transfer';

type TextPathMessage =
  | { readonly kind: 'plain'; readonly path: ColoredPath }
  | { readonly kind: 'packed'; readonly path: PackedColoredPath };

export type TextRenderResultMessage = Omit<TextRenderResult, 'paths'> & {
  readonly paths: ReadonlyArray<TextPathMessage>;
};

export function packTextRenderResult(result: TextRenderResult): {
  readonly message: TextRenderResultMessage;
  readonly transfer: ArrayBuffer[];
} {
  const transfer: ArrayBuffer[] = [];
  const paths = result.paths.map((path): TextPathMessage => {
    if (!packableTextPath(path)) return { kind: 'plain', path };
    const packed = packColoredPathMessage(path);
    transfer.push(...packed.transfer);
    return { kind: 'packed', path: packed.path };
  });
  return { message: { ...result, paths }, transfer };
}

export function unpackTextRenderResult(message: TextRenderResultMessage): TextRenderResult {
  return {
    ...message,
    paths: message.paths.map((entry) =>
      entry.kind === 'packed' ? unpackColoredPath(entry.path) : entry.path,
    ),
  };
}

function packableTextPath(path: ColoredPath): boolean {
  const keys = Object.keys(path);
  const hasCurves = keys.includes('curves');
  const tail = hasCurves ? keys.slice(-2) : keys.slice(-1);
  const expected = hasCurves ? ['polylines', 'curves'] : ['polylines'];
  if (!sameKeys(tail, expected)) return false;
  if (!Array.isArray(path.polylines) || !path.polylines.every(plainPolyline)) return false;
  if (!hasCurves) return true;
  return Array.isArray(path.curves) && path.curves.every(plainCurve);
}

function plainPolyline(polyline: Polyline): boolean {
  return (
    sameKeys(Object.keys(polyline), ['points', 'closed']) &&
    typeof polyline.closed === 'boolean' &&
    Array.isArray(polyline.points) &&
    polyline.points.every(plainPoint)
  );
}

function plainCurve(curve: CurveSubpath): boolean {
  return (
    sameKeys(Object.keys(curve), ['start', 'segments', 'closed']) &&
    typeof curve.closed === 'boolean' &&
    plainPoint(curve.start) &&
    Array.isArray(curve.segments) &&
    curve.segments.every(plainSegment)
  );
}

function plainSegment(segment: PathSegment): boolean {
  const keys = Object.keys(segment);
  if (segment.kind === 'line') return sameKeys(keys, ['kind', 'to']) && plainPoint(segment.to);
  if (segment.kind !== 'cubic') return false;
  return (
    sameKeys(keys, ['kind', 'control1', 'control2', 'to']) &&
    plainPoint(segment.control1) &&
    plainPoint(segment.control2) &&
    plainPoint(segment.to)
  );
}

function plainPoint(point: Vec2): boolean {
  return (
    typeof point === 'object' &&
    point !== null &&
    sameKeys(Object.keys(point), ['x', 'y']) &&
    typeof point.x === 'number' &&
    typeof point.y === 'number'
  );
}

function sameKeys(actual: ReadonlyArray<string>, expected: ReadonlyArray<string>): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
