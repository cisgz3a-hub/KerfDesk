import type { ColoredPath } from '../core/scene';
import type { RawImageData, TraceBoundary } from '../core/trace';

export const WHITE_ALPHA_REGION: TraceBoundary = { x: 45, y: 45, width: 20, height: 20 };
export const DETAIL_ALPHA_REGION: TraceBoundary = { x: 18, y: 18, width: 28, height: 28 };

/** Accepted TR003 white foreground, with a transparent full-source margin. */
export function whiteAlphaPatch(alpha = 255): RawImageData {
  const width = 128;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      data[(y * width + x) * 4 + 3] = x >= 45 && x < 65 && y >= 45 && y < 65 ? alpha : 0;
    }
  }
  return { width, height: width, data };
}

/** Exact alternate Enhance witness: the RGB detail has the same alpha as its surround. */
export function alphaRgbDetail(
  kind: 'detail' | 'white' | 'hole' | 'opaque' = 'detail',
): RawImageData {
  const width = 64;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const opaque = x >= 4 && x < 60 && y >= 4 && y < 60;
      const detail = x >= 25 && x < 39 && y >= 25 && y < 39;
      const value = kind !== 'white' && detail ? 0 : 255;
      data.set([value, value, value, detailAlpha(kind, opaque, detail)], offset);
    }
  }
  return { width, height: width, data };
}

function detailAlpha(kind: string, opaque: boolean, detail: boolean): number {
  if (kind === 'opaque') return 255;
  if (kind === 'hole' && detail) return 0;
  return opaque ? 255 : 0;
}

/** Independent even-odd ray crossing; it does not call the trace geometry helpers. */
export function alphaForegroundAt(
  paths: ReadonlyArray<ColoredPath>,
  x: number,
  y: number,
): boolean {
  let inside = false;
  for (const polyline of paths.flatMap((path) => path.polylines)) {
    if (!polyline.closed) continue;
    const points = polyline.points;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i]!;
      const b = points[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}
