// Vector-geometry worker results return as packed vertices (ADR-609).
//
// A structured clone would rebuild every {x, y} point of a large offset or
// weld on the UI thread while it deserializes the reply. The worker instead
// sends each path's vertices in transferred typed arrays and this thread
// rebuilds the polylines in one tight loop.
//
// Committed results must be byte-identical to the ones the in-thread action
// computes, including the key order a saved project writes. The worker
// therefore packs a path only when every polyline is exactly {closed, points}
// or {points, closed} (one order per path) and every point is exactly {x, y};
// anything else travels unchanged inside the ordinary clone. Spreading the
// original path keeps every other key in its original position.

import type { ColoredPath, ImportedSvg, Polyline, Vec2 } from '../../core/scene';

type PolylineKeyOrder = 'closed-points' | 'points-closed';

export type PackedResultPolylines = {
  readonly kind: 'packed-polylines';
  readonly order: PolylineKeyOrder;
  readonly xy: Float64Array;
  /** Point index where each polyline starts, plus a final end sentinel. */
  readonly starts: Uint32Array;
  readonly closed: Uint8Array;
};

export type ResultPathMessage = Omit<ColoredPath, 'polylines'> & {
  readonly polylines: ReadonlyArray<Polyline> | PackedResultPolylines;
};

export type ResultObjectMessage = Omit<ImportedSvg, 'paths'> & {
  readonly paths: ReadonlyArray<ResultPathMessage>;
};

/** Packs one result object; its new buffers are appended to `transfer`. */
export function packResultObject(
  object: ImportedSvg,
  transfer: ArrayBuffer[],
): ResultObjectMessage {
  return { ...object, paths: object.paths.map((path) => packResultPath(path, transfer)) };
}

export function unpackResultObject(message: ResultObjectMessage): ImportedSvg {
  return { ...message, paths: message.paths.map(unpackResultPath) };
}

function packResultPath(path: ColoredPath, transfer: ArrayBuffer[]): ResultPathMessage {
  const order = polylineKeyOrder(path.polylines);
  if (order === null) return path;
  let total = 0;
  for (const polyline of path.polylines) total += polyline.points.length;
  const xy = new Float64Array(total * 2);
  const starts = new Uint32Array(path.polylines.length + 1);
  const closed = new Uint8Array(path.polylines.length);
  let cursor = 0;
  path.polylines.forEach((polyline, index) => {
    starts[index] = cursor;
    closed[index] = polyline.closed ? 1 : 0;
    for (const point of polyline.points) {
      xy[cursor * 2] = point.x;
      xy[cursor * 2 + 1] = point.y;
      cursor += 1;
    }
  });
  starts[path.polylines.length] = cursor;
  transfer.push(xy.buffer, starts.buffer, closed.buffer);
  const polylines: PackedResultPolylines = { kind: 'packed-polylines', order, xy, starts, closed };
  return { ...path, polylines };
}

function unpackResultPath(path: ResultPathMessage): ColoredPath {
  const packed = path.polylines;
  if (!isPackedPolylines(packed)) return { ...path, polylines: packed };
  const polylines: Polyline[] = [];
  for (let index = 0; index + 1 < packed.starts.length; index += 1) {
    const from = packed.starts[index] ?? 0;
    const to = packed.starts[index + 1] ?? from;
    const points: Vec2[] = [];
    for (let point = from; point < to; point += 1) {
      points.push({ x: packed.xy[point * 2] ?? 0, y: packed.xy[point * 2 + 1] ?? 0 });
    }
    const closed = packed.closed[index] === 1;
    polylines.push(packed.order === 'closed-points' ? { closed, points } : { points, closed });
  }
  return { ...path, polylines };
}

function isPackedPolylines(
  polylines: ResultPathMessage['polylines'],
): polylines is PackedResultPolylines {
  return !Array.isArray(polylines);
}

function polylineKeyOrder(polylines: ReadonlyArray<Polyline>): PolylineKeyOrder | null {
  let order: PolylineKeyOrder | null = null;
  for (const polyline of polylines) {
    const current = keyOrder(polyline);
    if (current === null || (order !== null && current !== order)) return null;
    if (!Array.isArray(polyline.points) || !polyline.points.every(isPlainPoint)) return null;
    order = current;
  }
  return order ?? 'closed-points';
}

function keyOrder(polyline: Polyline): PolylineKeyOrder | null {
  if (typeof polyline.closed !== 'boolean') return null;
  const keys = Object.keys(polyline);
  if (keys.length !== 2) return null;
  if (keys[0] === 'closed' && keys[1] === 'points') return 'closed-points';
  if (keys[0] === 'points' && keys[1] === 'closed') return 'points-closed';
  return null;
}

function isPlainPoint(point: Vec2): boolean {
  const keys = Object.keys(point);
  return (
    keys.length === 2 &&
    keys[0] === 'x' &&
    keys[1] === 'y' &&
    typeof point.x === 'number' &&
    typeof point.y === 'number'
  );
}
