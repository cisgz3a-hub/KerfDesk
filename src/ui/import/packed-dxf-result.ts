import type {
  ColoredPath,
  CurveSubpath,
  ImportedSvg,
  PathSegment,
  Polyline,
} from '../../core/scene';
import type { ParseDxfResult } from '../../io/dxf';

const RANGE_WIDTH = 2;
const POINT_WIDTH = 2;
const SEGMENT_WIDTH = 7;
const SEGMENT_LINE = 0;
const SEGMENT_CUBIC = 1;
const SEGMENT_ARC = 2;
const HAS_CURVES = 1;

type DxfObjectMetadata = Omit<ImportedSvg, 'paths'>;
type DxfPathMetadata = Omit<ColoredPath, 'polylines' | 'curves'>;

type PackedDxfObject = {
  readonly metadata: DxfObjectMetadata;
  readonly pathMetadata: ReadonlyArray<DxfPathMetadata>;
  readonly pathFlags: Uint8Array;
  readonly pathPolylineRanges: Uint32Array;
  readonly polylinePointRanges: Uint32Array;
  readonly polylineClosed: Uint8Array;
  readonly polylinePoints: Float64Array;
  readonly pathCurveRanges: Uint32Array;
  readonly curveSegmentRanges: Uint32Array;
  readonly curveClosed: Uint8Array;
  readonly curveStarts: Float64Array;
  readonly segmentKinds: Uint8Array;
  readonly segmentData: Float64Array;
};

export type PackedDxfResult =
  | { readonly kind: 'error'; readonly reason: string }
  | {
      readonly kind: 'ok';
      readonly object: PackedDxfObject | null;
      readonly pathCount: number;
      readonly notes: ReadonlyArray<string>;
      readonly skippedSummary: string | null;
    };

export function packDxfResult(result: ParseDxfResult): PackedDxfResult {
  if (result.kind === 'error') return result;
  if (result.object === null) return { ...result, object: null };
  return { ...result, object: packObject(result.object) };
}

export function unpackDxfResult(result: PackedDxfResult): ParseDxfResult {
  if (result.kind === 'error') return result;
  if (result.object === null) return { ...result, object: null };
  return { ...result, object: unpackObject(result.object) };
}

export function packedDxfTransferables(result: PackedDxfResult): ReadonlyArray<ArrayBuffer> {
  if (result.kind === 'error' || result.object === null) return [];
  const object = result.object;
  return [
    transferableBuffer(object.pathFlags),
    transferableBuffer(object.pathPolylineRanges),
    transferableBuffer(object.polylinePointRanges),
    transferableBuffer(object.polylineClosed),
    transferableBuffer(object.polylinePoints),
    transferableBuffer(object.pathCurveRanges),
    transferableBuffer(object.curveSegmentRanges),
    transferableBuffer(object.curveClosed),
    transferableBuffer(object.curveStarts),
    transferableBuffer(object.segmentKinds),
    transferableBuffer(object.segmentData),
  ];
}

function packObject(object: ImportedSvg): PackedDxfObject {
  const counts = geometryCounts(object.paths);
  const packed = allocatePacked(object, counts);
  let polylineIndex = 0;
  let pointIndex = 0;
  let curveIndex = 0;
  let segmentIndex = 0;
  for (const [pathIndex, path] of object.paths.entries()) {
    writeRange(packed.pathPolylineRanges, pathIndex, polylineIndex, path.polylines.length);
    for (const polyline of path.polylines) {
      writeRange(packed.polylinePointRanges, polylineIndex, pointIndex, polyline.points.length);
      packed.polylineClosed[polylineIndex] = polyline.closed ? 1 : 0;
      for (const point of polyline.points) {
        writePoint(packed.polylinePoints, pointIndex, point);
        pointIndex += 1;
      }
      polylineIndex += 1;
    }
    if (path.curves !== undefined) {
      packed.pathFlags[pathIndex] = valueAt(packed.pathFlags, pathIndex, 'path flag') | HAS_CURVES;
    }
    const curves = path.curves ?? [];
    writeRange(packed.pathCurveRanges, pathIndex, curveIndex, curves.length);
    for (const curve of curves) {
      writePoint(packed.curveStarts, curveIndex, curve.start);
      packed.curveClosed[curveIndex] = curve.closed ? 1 : 0;
      writeRange(packed.curveSegmentRanges, curveIndex, segmentIndex, curve.segments.length);
      for (const segment of curve.segments) {
        writeSegment(packed, segmentIndex, segment);
        segmentIndex += 1;
      }
      curveIndex += 1;
    }
  }
  return packed;
}

function unpackObject(object: PackedDxfObject): ImportedSvg {
  const paths = object.pathMetadata.map((metadata, pathIndex): ColoredPath => {
    const polylines = readRange(object.pathPolylineRanges, pathIndex).map((polylineIndex) =>
      unpackPolyline(object, polylineIndex),
    );
    const curves =
      (valueAt(object.pathFlags, pathIndex, 'path flag') & HAS_CURVES) === 0
        ? undefined
        : readRange(object.pathCurveRanges, pathIndex).map((curveIndex) =>
            unpackCurve(object, curveIndex),
          );
    return { ...metadata, polylines, ...(curves === undefined ? {} : { curves }) };
  });
  return { ...object.metadata, paths };
}

function unpackPolyline(object: PackedDxfObject, index: number): Polyline {
  const points = readRange(object.polylinePointRanges, index).map((pointIndex) =>
    readPoint(object.polylinePoints, pointIndex),
  );
  return { points, closed: valueAt(object.polylineClosed, index, 'polyline flag') === 1 };
}

function unpackCurve(object: PackedDxfObject, index: number): CurveSubpath {
  const segments = readRange(object.curveSegmentRanges, index).map((segmentIndex) =>
    readSegment(object, segmentIndex),
  );
  return {
    start: readPoint(object.curveStarts, index),
    segments,
    closed: valueAt(object.curveClosed, index, 'curve flag') === 1,
  };
}

function readSegment(object: PackedDxfObject, index: number): PathSegment {
  const kind = valueAt(object.segmentKinds, index, 'segment kind');
  const base = index * SEGMENT_WIDTH;
  const value = (offset: number): number => valueAt(object.segmentData, base + offset, 'segment');
  if (kind === SEGMENT_LINE) return { kind: 'line', to: { x: value(0), y: value(1) } };
  if (kind === SEGMENT_CUBIC) {
    return {
      kind: 'cubic',
      control1: { x: value(0), y: value(1) },
      control2: { x: value(2), y: value(3) },
      to: { x: value(4), y: value(5) },
    };
  }
  if (kind !== SEGMENT_ARC) throw new Error(`Unknown packed DXF segment kind ${kind}.`);
  return {
    kind: 'elliptical-arc',
    radiusX: value(0),
    radiusY: value(1),
    rotationDeg: value(2),
    largeArc: value(3) === 1,
    sweep: value(4) === 1,
    to: { x: value(5), y: value(6) },
  };
}

type GeometryCounts = {
  readonly polylines: number;
  readonly points: number;
  readonly curves: number;
  readonly segments: number;
};

function geometryCounts(paths: ReadonlyArray<ColoredPath>): GeometryCounts {
  let polylines = 0;
  let points = 0;
  let curves = 0;
  let segments = 0;
  for (const path of paths) {
    polylines += path.polylines.length;
    points += path.polylines.reduce((sum, polyline) => sum + polyline.points.length, 0);
    curves += path.curves?.length ?? 0;
    segments += path.curves?.reduce((sum, curve) => sum + curve.segments.length, 0) ?? 0;
  }
  return { polylines, points, curves, segments };
}

function allocatePacked(object: ImportedSvg, counts: GeometryCounts): PackedDxfObject {
  const { paths, ...metadata } = object;
  return {
    metadata,
    pathMetadata: paths.map(({ polylines: _polylines, curves: _curves, ...rest }) => rest),
    pathFlags: new Uint8Array(paths.length),
    pathPolylineRanges: new Uint32Array(paths.length * RANGE_WIDTH),
    polylinePointRanges: new Uint32Array(counts.polylines * RANGE_WIDTH),
    polylineClosed: new Uint8Array(counts.polylines),
    polylinePoints: new Float64Array(counts.points * POINT_WIDTH),
    pathCurveRanges: new Uint32Array(paths.length * RANGE_WIDTH),
    curveSegmentRanges: new Uint32Array(counts.curves * RANGE_WIDTH),
    curveClosed: new Uint8Array(counts.curves),
    curveStarts: new Float64Array(counts.curves * POINT_WIDTH),
    segmentKinds: new Uint8Array(counts.segments),
    segmentData: new Float64Array(counts.segments * SEGMENT_WIDTH),
  };
}

function writeSegment(object: PackedDxfObject, index: number, segment: PathSegment): void {
  const base = index * SEGMENT_WIDTH;
  if (segment.kind === 'line') {
    object.segmentKinds[index] = SEGMENT_LINE;
    writeValues(object.segmentData, base, [segment.to.x, segment.to.y]);
  } else if (segment.kind === 'cubic') {
    object.segmentKinds[index] = SEGMENT_CUBIC;
    writeValues(object.segmentData, base, [
      segment.control1.x,
      segment.control1.y,
      segment.control2.x,
      segment.control2.y,
      segment.to.x,
      segment.to.y,
    ]);
  } else {
    object.segmentKinds[index] = SEGMENT_ARC;
    writeValues(object.segmentData, base, [
      segment.radiusX,
      segment.radiusY,
      segment.rotationDeg,
      segment.largeArc ? 1 : 0,
      segment.sweep ? 1 : 0,
      segment.to.x,
      segment.to.y,
    ]);
  }
}

function writeRange(target: Uint32Array, index: number, start: number, count: number): void {
  target[index * RANGE_WIDTH] = start;
  target[index * RANGE_WIDTH + 1] = count;
}

function readRange(target: Uint32Array, index: number): number[] {
  const start = valueAt(target, index * RANGE_WIDTH, 'range start');
  const count = valueAt(target, index * RANGE_WIDTH + 1, 'range count');
  return Array.from({ length: count }, (_, offset) => start + offset);
}

function writePoint(target: Float64Array, index: number, point: { x: number; y: number }): void {
  target[index * POINT_WIDTH] = point.x;
  target[index * POINT_WIDTH + 1] = point.y;
}

function readPoint(target: Float64Array, index: number): { x: number; y: number } {
  return {
    x: valueAt(target, index * POINT_WIDTH, 'point x'),
    y: valueAt(target, index * POINT_WIDTH + 1, 'point y'),
  };
}

function writeValues(target: Float64Array, start: number, values: ReadonlyArray<number>): void {
  target.set(values, start);
}

function valueAt(target: ArrayLike<number>, index: number, field: string): number {
  const value = target[index];
  if (value === undefined) throw new Error(`Packed DXF ${field} is missing at ${index}.`);
  return value;
}

function transferableBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new Error('Packed DXF unexpectedly uses a shared buffer.');
  }
  return view.buffer;
}
