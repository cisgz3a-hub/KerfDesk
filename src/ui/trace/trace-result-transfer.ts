// The trace worker's result in a form the UI thread can receive without a
// pause. Structured clone sends each traced vertex and segment as its own
// object, and Chromium deserialises that whole graph inside `onmessage` the
// first time `event.data` is read: 0.6-0.9 s at a 9 MP commit grid, in one
// task. Packed, the geometry crosses as three transferred typed arrays plus
// one small object per ColoredPath, and the UI thread rebuilds the objects in
// resumable steps that a cooperative runner can spread over several tasks.
//
// The rebuilt paths are what structured clone would have produced: the same
// values (Float64 keeps every double, -0 included), the same own keys in the
// same order, and the same sharing — a vertex object referenced by a
// polyline and by its curve is one object after unpacking too, which matters
// to code that keys sets on point identity (CNC contact pinning). Anything the
// packer does not recognise exactly (an unknown key, a non-boolean flag, a
// container referenced twice) makes it decline, and the caller posts the
// paths as before.

import type { ColoredPath, PathSegment, Polyline, Vec2 } from '../../core/scene';
import type { TraceSteps } from '../../core/trace/trace-steps';

export type PackedTracePaths = {
  // Each path's own fields with `polylines` (and `curves`, when an array) set
  // to 0: structured clone keeps the key order, so unpacking writes the
  // geometry back into the same positions.
  readonly shells: ReadonlyArray<Record<string, unknown>>;
  // Key lists, one per distinct object shape met while packing.
  readonly shapes: ReadonlyArray<ReadonlyArray<string>>;
  // x, y of every distinct vertex object, in first-seen order.
  readonly coords: Float64Array;
  // The geometry's structure, read back in the order it was written.
  readonly structure: Uint32Array;
  // Elliptical-arc radii and rotation, in segment order.
  readonly numbers: Float64Array;
};

const SEGMENT_KINDS = ['line', 'cubic', 'elliptical-arc'] as const;
const POLYLINE_KEYS = new Set(['points', 'closed']);
const CURVE_KEYS = new Set(['start', 'segments', 'closed']);
// Indexed like SEGMENT_KINDS.
const SEGMENT_KEYS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['kind', 'to']),
  new Set(['kind', 'control1', 'control2', 'to']),
  new Set(['kind', 'radiusX', 'radiusY', 'rotationDeg', 'largeArc', 'sweep', 'to']),
];
// Vertices rebuilt between checkpoints when a cooperative runner drives
// unpacking: well under a millisecond of object creation.
const VERTICES_PER_CHECKPOINT = 8_192;

/** Transferable buffers of a packed result, for postMessage's transfer list. */
export function packedTracePathsTransfer(packed: PackedTracePaths): ArrayBuffer[] {
  return [packed.coords.buffer, packed.structure.buffer, packed.numbers.buffer] as ArrayBuffer[];
}

class Declined extends Error {}

function decline(): never {
  throw new Declined();
}

/** Pack `paths`, or return null when they hold anything this format does not
 *  reproduce exactly (the caller then posts them unpacked). */
export function packTracePaths(paths: ReadonlyArray<ColoredPath>): PackedTracePaths | null {
  if (!Array.isArray(paths)) return null;
  const packer = new Packer();
  try {
    const shells = paths.map((path) => packer.path(path));
    return packer.finish(shells);
  } catch (error) {
    if (error instanceof Declined) return null;
    throw error;
  }
}

class Packer {
  private readonly coords = new GrowableArray((length) => new Float64Array(length));
  private readonly structure = new GrowableArray((length) => new Uint32Array(length));
  private readonly numbers = new GrowableArray((length) => new Float64Array(length));
  private readonly vertexIndex = new Map<unknown, number>();
  private readonly containers = new Set<unknown>();
  private readonly shapeIndex = new Map<string, number>();
  private readonly shapes: string[][] = [];

  path(path: ColoredPath): Record<string, unknown> {
    if (!isPlainObject(path) || !Array.isArray(path.polylines)) decline();
    this.claim(path);
    this.claim(path.polylines);
    const hasCurves = path.curves !== undefined;
    if (hasCurves && !Array.isArray(path.curves)) decline();
    this.structure.push(path.polylines.length);
    for (const polyline of path.polylines) this.polyline(polyline);
    this.structure.push(hasCurves ? 1 : 0);
    if (hasCurves) {
      const curves = path.curves as ColoredPath['curves'] & object;
      this.claim(curves);
      this.structure.push(curves.length);
      for (const curve of curves) this.curve(curve);
    }
    return { ...path, polylines: 0, ...(hasCurves ? { curves: 0 } : {}) };
  }

  finish(shells: Record<string, unknown>[]): PackedTracePaths {
    return {
      shells,
      shapes: this.shapes,
      coords: this.coords.toTyped(),
      structure: this.structure.toTyped(),
      numbers: this.numbers.toTyped(),
    };
  }

  private polyline(polyline: Polyline): void {
    for (const key of this.shape(polyline, POLYLINE_KEYS)) {
      if (key === 'closed') this.flag(polyline.closed);
      else this.vertices(polyline.points);
    }
  }

  private curve(curve: unknown): void {
    const record = curve as Record<string, unknown>;
    for (const key of this.shape(curve, CURVE_KEYS)) {
      if (key === 'closed') this.flag(record['closed']);
      else if (key === 'start') this.structure.push(this.vertex(record['start']));
      else this.segments(record['segments']);
    }
  }

  private segments(segments: unknown): void {
    if (!Array.isArray(segments)) decline();
    this.claim(segments);
    this.structure.push(segments.length);
    for (const segment of segments) this.segment(segment);
  }

  private segment(segment: unknown): void {
    if (!isPlainObject(segment)) decline();
    const kind = SEGMENT_KINDS.indexOf(segment['kind'] as PathSegment['kind']);
    for (const key of this.shape(segment, SEGMENT_KEYS[kind] ?? decline())) {
      const value = segment[key];
      if (key === 'kind') this.structure.push(kind);
      else if (key === 'largeArc' || key === 'sweep') this.flag(value);
      else if (key === 'to' || key === 'control1' || key === 'control2') {
        this.structure.push(this.vertex(value));
      } else if (typeof value === 'number') this.numbers.push(value);
      else decline();
    }
  }

  private vertices(points: unknown): void {
    if (!Array.isArray(points)) decline();
    this.claim(points);
    this.structure.push(points.length);
    for (const point of points) this.structure.push(this.vertex(point));
  }

  private vertex(point: unknown): number {
    const known = this.vertexIndex.get(point);
    if (known !== undefined) return known;
    if (!isPlainObject(point)) decline();
    const keys = Object.keys(point);
    const { x, y } = point as Vec2;
    if (keys.length !== 2 || keys[0] !== 'x' || keys[1] !== 'y') decline();
    if (typeof x !== 'number' || typeof y !== 'number') decline();
    const index = this.vertexIndex.size;
    this.vertexIndex.set(point, index);
    this.coords.push(x);
    this.coords.push(y);
    return index;
  }

  private flag(value: unknown): void {
    if (typeof value !== 'boolean') decline();
    this.structure.push(value ? 1 : 0);
  }

  // Record the object's own keys (each must be one this format knows) and
  // return them, so its fields are written in that order.
  private shape(value: unknown, allowed: ReadonlySet<string>): string[] {
    if (!isPlainObject(value)) decline();
    this.claim(value);
    const keys = Object.keys(value);
    for (const key of keys) if (!allowed.has(key)) decline();
    const signature = keys.join(',');
    let id = this.shapeIndex.get(signature);
    if (id === undefined) {
      id = this.shapes.length;
      this.shapeIndex.set(signature, id);
      this.shapes.push(keys);
    }
    this.structure.push(id);
    return keys;
  }

  // Structured clone keeps an object referenced twice as one object; this
  // format would make two, so such a result is posted unpacked.
  private claim(container: object): void {
    if (this.containers.has(container)) decline();
    this.containers.add(container);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

class GrowableArray<T extends Float64Array | Uint32Array> {
  private buffer: T;
  private length = 0;

  constructor(private readonly allocate: (length: number) => T) {
    this.buffer = allocate(1024);
  }

  push(value: number): void {
    if (this.length === this.buffer.length) {
      const grown = this.allocate(this.buffer.length * 2);
      grown.set(this.buffer);
      this.buffer = grown;
    }
    this.buffer[this.length] = value;
    this.length += 1;
  }

  toTyped(): T {
    return this.buffer.slice(0, this.length) as T;
  }
}

/** Rebuild the paths packTracePaths packed, as resumable steps. */
export function* unpackTracePathsSteps(packed: PackedTracePaths): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const reader = new Unpacker(packed);
  const paths: ColoredPath[] = [];
  for (const shell of packed.shells) {
    const path = { ...shell };
    const polylines: Polyline[] = [];
    const polylineCount = reader.next();
    for (let index = 0; index < polylineCount; index += 1) {
      polylines.push(reader.polyline());
      if (cooperate && reader.checkpointDue()) yield;
    }
    path['polylines'] = polylines;
    if (reader.next() === 1) {
      const curves: unknown[] = [];
      const curveCount = reader.next();
      for (let index = 0; index < curveCount; index += 1) {
        curves.push(reader.curve());
        if (cooperate && reader.checkpointDue()) yield;
      }
      path['curves'] = curves;
    }
    paths.push(path as ColoredPath);
  }
  return paths;
}

class Unpacker {
  private readonly vertices: Array<Vec2 | undefined>;
  private cursor = 0;
  private numberCursor = 0;
  private sinceCheckpoint = 0;

  constructor(private readonly packed: PackedTracePaths) {
    this.vertices = new Array<Vec2 | undefined>(packed.coords.length / 2);
  }

  next(): number {
    const value = this.packed.structure[this.cursor];
    this.cursor += 1;
    return value as number;
  }

  checkpointDue(): boolean {
    if (this.sinceCheckpoint < VERTICES_PER_CHECKPOINT) return false;
    this.sinceCheckpoint = 0;
    return true;
  }

  polyline(): Polyline {
    const keys = this.packed.shapes[this.next()] as ReadonlyArray<string>;
    // The tracer's own shape, built as a literal: the common case by far.
    if (keys.length === 2 && keys[0] === 'points') {
      const points = this.vertexList();
      return { points, closed: this.next() === 1 };
    }
    const polyline: Record<string, unknown> = {};
    for (const key of keys) {
      polyline[key] = key === 'closed' ? this.next() === 1 : this.vertexList();
    }
    return polyline as Polyline;
  }

  curve(): unknown {
    const keys = this.packed.shapes[this.next()] as ReadonlyArray<string>;
    const curve: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === 'closed') curve[key] = this.next() === 1;
      else if (key === 'start') curve[key] = this.vertex(this.next());
      else curve[key] = this.segments();
    }
    return curve;
  }

  private segments(): unknown[] {
    const count = this.next();
    const segments: unknown[] = [];
    for (let index = 0; index < count; index += 1) segments.push(this.segment());
    return segments;
  }

  private segment(): unknown {
    const keys = this.packed.shapes[this.next()] as ReadonlyArray<string>;
    if (keys.length === 2 && keys[0] === 'kind' && keys[1] === 'to') {
      const kind = SEGMENT_KINDS[this.next()];
      return { kind, to: this.vertex(this.next()) };
    }
    const segment: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === 'kind') segment[key] = SEGMENT_KINDS[this.next()];
      else if (key === 'largeArc' || key === 'sweep') segment[key] = this.next() === 1;
      else if (key === 'to' || key === 'control1' || key === 'control2') {
        segment[key] = this.vertex(this.next());
      } else {
        segment[key] = this.packed.numbers[this.numberCursor];
        this.numberCursor += 1;
      }
    }
    return segment;
  }

  private vertexList(): Vec2[] {
    const count = this.next();
    const points: Vec2[] = [];
    for (let index = 0; index < count; index += 1) points.push(this.vertex(this.next()));
    return points;
  }

  private vertex(index: number): Vec2 {
    const known = this.vertices[index];
    if (known !== undefined) return known;
    const coords = this.packed.coords;
    const point = { x: coords[2 * index] as number, y: coords[2 * index + 1] as number };
    this.vertices[index] = point;
    this.sinceCheckpoint += 1;
    return point;
  }
}
