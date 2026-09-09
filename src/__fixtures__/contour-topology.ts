import type { Polyline, Vec2 } from '../core/scene';
import type { RawImageData } from '../core/trace/trace-image';

const SIZE = 128;

/** Opaque native-grid witnesses with a narrow notch or two separate components. */
export function contourTopologyImage(kind: 'notch' | 'separate'): RawImageData {
  const image = {
    width: SIZE,
    height: SIZE,
    data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(255),
  };
  if (kind === 'notch') {
    rectangle(image, 20, 20, 44, 44, 0);
    rectangle(image, 41, 20, 2, 28, 255);
  } else {
    rectangle(image, 20, 40, 40, 40, 0);
    rectangle(image, 61, 40, 40, 40, 0);
  }
  return image;
}

function rectangle(
  image: RawImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  luma: number,
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      image.data.set([luma, luma, luma, 255], (row * image.width + col) * 4);
    }
  }
}

/** Brute-force proper crossings, including the closing edges of these fixtures. */
export function contourCrossings(polylines: ReadonlyArray<Polyline>): number {
  const edges = polylines.flatMap((polyline, owner) =>
    polyline.points.slice(1).map((b, i) => ({
      owner,
      i,
      count: polyline.points.length - 1,
      a: polyline.points[i] as Vec2,
      b,
    })),
  );
  let crossings = 0;
  for (let i = 0; i < edges.length; i += 1) {
    const a = edges[i];
    if (a === undefined) continue;
    for (const b of edges.slice(i + 1)) {
      if (a.owner === b.owner && (b.i === a.i + 1 || (a.i === 0 && b.i === a.count - 1))) continue;
      if (
        cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) < 0 &&
        cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) < 0
      )
        crossings += 1;
    }
  }
  return crossings;
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Exact segment-distance formula evaluated in floating point, not a raster gap. */
export function contourGap(a: Polyline, b: Polyline): number {
  let result = Infinity;
  for (let i = 1; i < a.points.length; i += 1) {
    for (let j = 1; j < b.points.length; j += 1) {
      const p = a.points[i - 1] as Vec2;
      const q = a.points[i] as Vec2;
      const r = b.points[j - 1] as Vec2;
      const s = b.points[j] as Vec2;
      result = Math.min(
        result,
        distance(p, r, s),
        distance(q, r, s),
        distance(r, p, q),
        distance(s, p, q),
      );
    }
  }
  return result;
}

function distance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
