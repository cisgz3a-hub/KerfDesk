import type { PackedColoredPath, PackedObjectGeometry } from './packed-project-transfer';

type GeometryArray = Float64Array | Uint32Array | Uint8Array;
type CopyArray = <T extends GeometryArray>(source: T) => T;

// One native transferable per project, rather than nine per curved path. The
// memoized geometry stays owned by the sender; this buffer is a fresh copy.
export function copyPackedGeometryForTransfer(geometry: ReadonlyArray<PackedObjectGeometry>): {
  readonly geometry: ReadonlyArray<PackedObjectGeometry>;
  readonly transfer: ArrayBuffer[];
} {
  const buffer = new ArrayBuffer(packedByteLength(geometry));
  let offset = 0;
  const copy: CopyArray = <T extends GeometryArray>(source: T): T => {
    offset = alignedOffset(offset, source.BYTES_PER_ELEMENT);
    const view =
      source instanceof Float64Array
        ? new Float64Array(buffer, offset, source.length)
        : source instanceof Uint32Array
          ? new Uint32Array(buffer, offset, source.length)
          : new Uint8Array(buffer, offset, source.length);
    view.set(source);
    offset += source.byteLength;
    return view as T;
  };
  return {
    geometry: geometry.map((entry) => ({
      index: entry.index,
      paths: entry.paths.map((path) => copyPath(path, copy)),
    })),
    transfer: [buffer],
  };
}

function alignedOffset(offset: number, alignment: number): number {
  return Math.ceil(offset / alignment) * alignment;
}

function packedByteLength(geometry: ReadonlyArray<PackedObjectGeometry>): number {
  let bytes = 0;
  for (const entry of geometry) {
    for (const path of entry.paths) {
      for (const array of pathArrays(path)) {
        bytes = alignedOffset(bytes, array.BYTES_PER_ELEMENT) + array.byteLength;
      }
    }
  }
  return bytes;
}

function pathArrays(path: PackedColoredPath): GeometryArray[] {
  const { polylines, curves } = path;
  const arrays: GeometryArray[] = [polylines.xy, polylines.starts, polylines.closed];
  if (curves !== undefined && !curves.derived) {
    arrays.push(
      curves.start,
      curves.closed,
      curves.segmentStarts,
      curves.kinds,
      curves.flags,
      curves.values,
    );
  }
  return arrays;
}

function copyPath(path: PackedColoredPath, copy: CopyArray): PackedColoredPath {
  const polylines = {
    xy: copy(path.polylines.xy),
    starts: copy(path.polylines.starts),
    closed: copy(path.polylines.closed),
  };
  if (path.curves === undefined || path.curves.derived) return { ...path, polylines };
  return {
    ...path,
    polylines,
    curves: {
      derived: false,
      start: copy(path.curves.start),
      closed: copy(path.curves.closed),
      segmentStarts: copy(path.curves.segmentStarts),
      kinds: copy(path.curves.kinds),
      flags: copy(path.curves.flags),
      values: copy(path.curves.values),
    },
  };
}
