// Projects cross a worker boundary as packed geometry (ADR-346).
//
// postMessage structured-clones its argument on the SENDING thread. A traced
// image is a million small {x, y} objects plus a canonical curve per polyline,
// and cloning that graph measured 0.5–1.2 s of main-thread time in Chrome —
// paid twice after every edit (ETA + idle markers) and again on every
// autosave. The same vertices in a Float64Array cross the boundary as a
// transferred buffer in constant time, so this module replaces every vector
// object's `paths` with typed arrays for the trip and rebuilds the identical
// objects on the receiving side.
//
// Exactness: every coordinate is a double in and a double out; polyline and
// curve order, closed flags, colours, operation bindings, fill rules and
// stroke metadata are preserved field for field. Curves that are the
// canonical straight-line view of their own polylines (every trace) are sent
// as a flag and rebuilt with polylineToCurveSubpath, halving the payload.
// Everything that is not vector geometry (rasters, reliefs, text settings,
// device, job setup) travels untouched inside the ordinary clone.
//
// Small projects are sent as they are: the packing itself is only worth its
// bookkeeping once there are thousands of points to clone.

import {
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Project,
  type SceneObject,
} from '../core/scene';

/** Below this many vertices the ordinary structured clone is sent unchanged. */
export const PACK_MIN_POINTS = 5_000;

const SEGMENT_LINE = 0;
const SEGMENT_CUBIC = 1;
const SEGMENT_ARC = 2;
const ARC_FLAG_LARGE = 1;
const ARC_FLAG_SWEEP = 2;

export type PackedPolylines = {
  readonly xy: Float64Array;
  /** Point index where each polyline starts, plus a final end sentinel. */
  readonly starts: Uint32Array;
  readonly closed: Uint8Array;
};

export type PackedCurves =
  | { readonly derived: true }
  | {
      readonly derived: false;
      readonly start: Float64Array;
      readonly closed: Uint8Array;
      /** Segment index where each curve starts, plus a final end sentinel. */
      readonly segmentStarts: Uint32Array;
      readonly kinds: Uint8Array;
      readonly flags: Uint8Array;
      readonly values: Float64Array;
    };

export type PackedColoredPath = Omit<ColoredPath, 'polylines' | 'curves'> & {
  readonly polylines: PackedPolylines;
  readonly curves?: PackedCurves;
};

export type PackedObjectGeometry = {
  readonly index: number;
  readonly paths: ReadonlyArray<PackedColoredPath>;
};

export type PackedProjectMessage = {
  readonly kind: 'packed-project';
  /** The project with every packed object's `paths` emptied. */
  readonly project: Project;
  readonly geometry: ReadonlyArray<PackedObjectGeometry>;
};

export type ProjectMessage = Project | PackedProjectMessage;

export type ProjectTransfer = {
  readonly message: ProjectMessage;
  /** Buffers to hand to postMessage; empty when the project is sent as is. */
  readonly transfer: ArrayBuffer[];
};

type VectorObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

// Packing is memoized per immutable `paths` array: a burst of moves replaces
// the object but not its geometry, so only the transferred copy is paid again.
const packedPaths = new WeakMap<ReadonlyArray<ColoredPath>, ReadonlyArray<PackedColoredPath>>();

export function isPackedProjectMessage(message: ProjectMessage): message is PackedProjectMessage {
  return 'kind' in message && message.kind === 'packed-project';
}

export function packProjectMessage(project: Project): ProjectTransfer {
  if (countVectorPoints(project) < PACK_MIN_POINTS) return { message: project, transfer: [] };
  const transfer: ArrayBuffer[] = [];
  const geometry: PackedObjectGeometry[] = [];
  const objects = project.scene.objects.map((object, index) => {
    if (!hasPaths(object) || object.paths.length === 0) return object;
    const paths = packedPathsFor(object.paths).map((path) => copyForTransfer(path, transfer));
    geometry.push({ index, paths });
    return { ...object, paths: [] };
  });
  return {
    message: {
      kind: 'packed-project',
      project: { ...project, scene: { ...project.scene, objects } },
      geometry,
    },
    transfer,
  };
}

export function unpackProjectMessage(message: ProjectMessage): Project {
  if (!isPackedProjectMessage(message)) return message;
  const byIndex = new Map(message.geometry.map((entry) => [entry.index, entry.paths]));
  const objects = message.project.scene.objects.map((object, index) => {
    const packed = byIndex.get(index);
    if (packed === undefined || !hasPaths(object)) return object;
    return { ...object, paths: packed.map(unpackColoredPath) };
  });
  return { ...message.project, scene: { ...message.project.scene, objects } };
}

function hasPaths(object: SceneObject): object is VectorObject {
  return 'paths' in object;
}

function countVectorPoints(project: Project): number {
  let count = 0;
  for (const object of project.scene.objects) {
    if (!hasPaths(object)) continue;
    for (const path of object.paths) {
      for (const polyline of path.polylines) count += polyline.points.length;
      if (path.curves !== undefined) {
        for (const curve of path.curves) count += curve.segments.length;
      }
    }
  }
  return count;
}

function packedPathsFor(paths: ReadonlyArray<ColoredPath>): ReadonlyArray<PackedColoredPath> {
  const cached = packedPaths.get(paths);
  if (cached !== undefined) return cached;
  const packed = paths.map(packColoredPath);
  packedPaths.set(paths, packed);
  return packed;
}

function packColoredPath(path: ColoredPath): PackedColoredPath {
  const { polylines, curves, ...rest } = path;
  return {
    ...rest,
    polylines: packPolylines(polylines),
    ...(curves === undefined ? {} : { curves: packCurves(curves, polylines) }),
  };
}

function packPolylines(polylines: ReadonlyArray<Polyline>): PackedPolylines {
  let total = 0;
  for (const polyline of polylines) total += polyline.points.length;
  const xy = new Float64Array(total * 2);
  const starts = new Uint32Array(polylines.length + 1);
  const closed = new Uint8Array(polylines.length);
  let cursor = 0;
  polylines.forEach((polyline, index) => {
    starts[index] = cursor;
    closed[index] = polyline.closed ? 1 : 0;
    for (const point of polyline.points) {
      xy[cursor * 2] = point.x;
      xy[cursor * 2 + 1] = point.y;
      cursor += 1;
    }
  });
  starts[polylines.length] = cursor;
  return { xy, starts, closed };
}

function packCurves(
  curves: ReadonlyArray<CurveSubpath>,
  polylines: ReadonlyArray<Polyline>,
): PackedCurves {
  if (curvesDerivedFromPolylines(curves, polylines)) return { derived: true };
  let segmentCount = 0;
  let valueCount = 0;
  for (const curve of curves) {
    segmentCount += curve.segments.length;
    for (const segment of curve.segments) valueCount += segmentValueWidth(segment.kind);
  }
  const start = new Float64Array(curves.length * 2);
  const closed = new Uint8Array(curves.length);
  const segmentStarts = new Uint32Array(curves.length + 1);
  const kinds = new Uint8Array(segmentCount);
  const flags = new Uint8Array(segmentCount);
  const values = new Float64Array(valueCount);
  let segmentIndex = 0;
  let valueIndex = 0;
  curves.forEach((curve, index) => {
    start[index * 2] = curve.start.x;
    start[index * 2 + 1] = curve.start.y;
    closed[index] = curve.closed ? 1 : 0;
    segmentStarts[index] = segmentIndex;
    for (const segment of curve.segments) {
      valueIndex = writeSegment(segment, kinds, flags, values, segmentIndex, valueIndex);
      segmentIndex += 1;
    }
  });
  segmentStarts[curves.length] = segmentIndex;
  return { derived: false, start, closed, segmentStarts, kinds, flags, values };
}

function writeSegment(
  segment: PathSegment,
  kinds: Uint8Array,
  flags: Uint8Array,
  values: Float64Array,
  segmentIndex: number,
  valueIndex: number,
): number {
  if (segment.kind === 'line') {
    kinds[segmentIndex] = SEGMENT_LINE;
    values[valueIndex] = segment.to.x;
    values[valueIndex + 1] = segment.to.y;
    return valueIndex + 2;
  }
  if (segment.kind === 'cubic') {
    kinds[segmentIndex] = SEGMENT_CUBIC;
    values.set(
      [
        segment.control1.x,
        segment.control1.y,
        segment.control2.x,
        segment.control2.y,
        segment.to.x,
        segment.to.y,
      ],
      valueIndex,
    );
    return valueIndex + 6;
  }
  kinds[segmentIndex] = SEGMENT_ARC;
  flags[segmentIndex] =
    (segment.largeArc ? ARC_FLAG_LARGE : 0) | (segment.sweep ? ARC_FLAG_SWEEP : 0);
  values.set(
    [segment.radiusX, segment.radiusY, segment.rotationDeg, segment.to.x, segment.to.y],
    valueIndex,
  );
  return valueIndex + 5;
}

function segmentValueWidth(kind: PathSegment['kind']): number {
  if (kind === 'line') return 2;
  if (kind === 'cubic') return 6;
  return 5;
}

// True when the curves are exactly what polylineToCurveSubpath would rebuild
// from the polylines: compared by value, so a project reloaded from disk (no
// shared point objects) still qualifies.
function curvesDerivedFromPolylines(
  curves: ReadonlyArray<CurveSubpath>,
  polylines: ReadonlyArray<Polyline>,
): boolean {
  if (curves.length !== polylines.length) return false;
  return curves.every((curve, index) => {
    const polyline = polylines[index];
    return polyline !== undefined && curveDerivedFromPolyline(curve, polyline);
  });
}

function curveDerivedFromPolyline(curve: CurveSubpath, polyline: Polyline): boolean {
  const points = polyline.points;
  const first = points[0];
  if (first === undefined || curve.closed !== polyline.closed) return false;
  if (curve.segments.length !== points.length - 1) return false;
  if (curve.start.x !== first.x || curve.start.y !== first.y) return false;
  return curve.segments.every((segment, j) => {
    const point = points[j + 1];
    return (
      point !== undefined &&
      segment.kind === 'line' &&
      segment.to.x === point.x &&
      segment.to.y === point.y
    );
  });
}

function copyForTransfer(path: PackedColoredPath, transfer: ArrayBuffer[]): PackedColoredPath {
  const polylines: PackedPolylines = {
    xy: copyArray(path.polylines.xy, transfer),
    starts: copyArray(path.polylines.starts, transfer),
    closed: copyArray(path.polylines.closed, transfer),
  };
  if (path.curves === undefined) return { ...path, polylines };
  if (path.curves.derived) return { ...path, polylines, curves: path.curves };
  const curves: PackedCurves = {
    derived: false,
    start: copyArray(path.curves.start, transfer),
    closed: copyArray(path.curves.closed, transfer),
    segmentStarts: copyArray(path.curves.segmentStarts, transfer),
    kinds: copyArray(path.curves.kinds, transfer),
    flags: copyArray(path.curves.flags, transfer),
    values: copyArray(path.curves.values, transfer),
  };
  return { ...path, polylines, curves };
}

function copyArray<T extends Float64Array | Uint32Array | Uint8Array>(
  source: T,
  transfer: ArrayBuffer[],
): T {
  const copy = source.slice() as T;
  transfer.push(copy.buffer as ArrayBuffer);
  return copy;
}

function unpackColoredPath(packed: PackedColoredPath): ColoredPath {
  const { polylines: packedPolylines, curves: packedCurves, ...rest } = packed;
  const polylines = unpackPolylines(packedPolylines);
  if (packedCurves === undefined) return { ...rest, polylines };
  const curves = packedCurves.derived
    ? polylines.map(polylineToCurveSubpath)
    : unpackCurves(packedCurves);
  return { ...rest, polylines, curves };
}

function unpackPolylines(packed: PackedPolylines): Polyline[] {
  const polylines: Polyline[] = [];
  for (let index = 0; index + 1 < packed.starts.length; index += 1) {
    const from = packed.starts[index] ?? 0;
    const to = packed.starts[index + 1] ?? from;
    const points = [];
    for (let cursor = from; cursor < to; cursor += 1) {
      points.push({ x: packed.xy[cursor * 2] ?? 0, y: packed.xy[cursor * 2 + 1] ?? 0 });
    }
    polylines.push({ points, closed: packed.closed[index] === 1 });
  }
  return polylines;
}

function unpackCurves(packed: Extract<PackedCurves, { derived: false }>): CurveSubpath[] {
  const curves: CurveSubpath[] = [];
  let valueIndex = 0;
  for (let index = 0; index + 1 < packed.segmentStarts.length; index += 1) {
    const from = packed.segmentStarts[index] ?? 0;
    const to = packed.segmentStarts[index + 1] ?? from;
    const segments: PathSegment[] = [];
    for (let cursor = from; cursor < to; cursor += 1) {
      const read = readSegment(packed, cursor, valueIndex);
      segments.push(read.segment);
      valueIndex = read.next;
    }
    curves.push({
      start: { x: packed.start[index * 2] ?? 0, y: packed.start[index * 2 + 1] ?? 0 },
      segments,
      closed: packed.closed[index] === 1,
    });
  }
  return curves;
}

function readSegment(
  packed: Extract<PackedCurves, { derived: false }>,
  segmentIndex: number,
  valueIndex: number,
): { readonly segment: PathSegment; readonly next: number } {
  const value = (offset: number): number => packed.values[valueIndex + offset] ?? 0;
  const kind = packed.kinds[segmentIndex];
  if (kind === SEGMENT_LINE) {
    return { segment: { kind: 'line', to: { x: value(0), y: value(1) } }, next: valueIndex + 2 };
  }
  if (kind === SEGMENT_CUBIC) {
    return {
      segment: {
        kind: 'cubic',
        control1: { x: value(0), y: value(1) },
        control2: { x: value(2), y: value(3) },
        to: { x: value(4), y: value(5) },
      },
      next: valueIndex + 6,
    };
  }
  const flags = packed.flags[segmentIndex] ?? 0;
  return {
    segment: {
      kind: 'elliptical-arc',
      radiusX: value(0),
      radiusY: value(1),
      rotationDeg: value(2),
      largeArc: (flags & ARC_FLAG_LARGE) !== 0,
      sweep: (flags & ARC_FLAG_SWEEP) !== 0,
      to: { x: value(3), y: value(4) },
    },
    next: valueIndex + 5,
  };
}
