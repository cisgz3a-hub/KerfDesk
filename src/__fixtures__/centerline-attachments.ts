import type { RawImageData } from '../core/trace/trace-image';
export type Point = { x: number; y: number };
export function white(size = 128): RawImageData {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
}
export function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = dx * dx + dy * dy,
    t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function paint(im: RawImageData, ink: (p: Point) => boolean) {
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++)
      if (ink({ x: x + 0.5, y: y + 0.5 })) {
        const at = 4 * (y * im.width + x);
        im.data[at] = im.data[at + 1] = im.data[at + 2] = 0;
      }
  return im;
}
export function line(im: RawImageData, a: Point, b: Point, r = 3) {
  return paint(im, (p) => distance(p, a, b) <= r);
}
export const names = [
  'Y',
  'ring_branch',
  'T',
  'X',
  'unequal_Y',
  'multiple_T',
  'ring_multiple',
  'deliberate_gap',
  'near_parallel',
  'rounded',
  'corner',
] as const;
export function fixture(name: string): RawImageData {
  const im = white();
  if (name === 'Y' || name === 'unequal_Y') {
    fork(im, name === 'unequal_Y');
  } else if (name === 'ring_branch' || name === 'ring_multiple') {
    ringWithBranches(im, name === 'ring_multiple');
  } else if (name === 'T' || name === 'multiple_T') {
    tee(im, name === 'multiple_T');
  } else if (name === 'X') {
    line(im, { x: 22.5, y: 22.5 }, { x: 106.5, y: 106.5 }, 3);
    line(im, { x: 22.5, y: 106.5 }, { x: 106.5, y: 22.5 }, 3);
  } else if (name === 'deliberate_gap') {
    line(im, { x: 20.5, y: 64.5 }, { x: 57.5, y: 64.5 }, 1);
    line(im, { x: 64.5, y: 64.5 }, { x: 109.5, y: 64.5 }, 1);
  } else if (name === 'near_parallel') {
    line(im, { x: 20.5, y: 50.5 }, { x: 110.5, y: 50.5 }, 2);
    line(im, { x: 20.5, y: 57.5 }, { x: 110.5, y: 57.5 }, 2);
  } else if (name === 'rounded') {
    paint(im, (p) => Math.abs(Math.hypot((p.x - 64.5) / 1.4, p.y - 64.5) - 28) <= 2.5);
  } else if (name === 'corner') {
    line(im, { x: 22.5, y: 104.5 }, { x: 22.5, y: 25.5 }, 3);
    line(im, { x: 22.5, y: 25.5 }, { x: 107.5, y: 25.5 }, 3);
  } else throw Error('Unknown fixture ' + name);
  return im;
}

function fork(im: RawImageData, unequal: boolean): void {
  const origin = { x: 64.5, y: 64.5 };
  [
    { x: 24.5, y: 22.5 },
    { x: 104.5, y: 22.5 },
    { x: 64.5, y: 109.5 },
  ].forEach((p, i) => line(im, origin, p, unequal ? [2, 5, 3][i] : 3));
}

function ringWithBranches(im: RawImageData, multiple: boolean): void {
  paint(im, (p) => Math.abs(Math.hypot(p.x - 58.5, p.y - 64.5) - 28) <= 3);
  line(im, { x: 86.5, y: 64.5 }, { x: 112.5, y: 64.5 }, 3);
  if (multiple) {
    line(im, { x: 58.5, y: 36.5 }, { x: 58.5, y: 13.5 }, 3);
    line(im, { x: 30.5, y: 64.5 }, { x: 10.5, y: 64.5 }, 3);
  }
}

function tee(im: RawImageData, multiple: boolean): void {
  line(im, { x: 16.5, y: 48.5 }, { x: 112.5, y: 48.5 }, 3);
  const x = multiple ? 40.5 : 64.5;
  line(im, { x, y: 48.5 }, { x, y: 112.5 }, 3);
  if (multiple) line(im, { x: 86.5, y: 48.5 }, { x: 86.5, y: 16.5 }, 2);
}
export function transform(
  im: RawImageData,
  kind: 'rotate' | 'reflect' | 'translate',
): RawImageData {
  const out = white(kind === 'translate' ? 160 : 128);
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++) {
      const nx = kind === 'rotate' ? 127 - y : kind === 'reflect' ? 127 - x : x + 11,
        ny = kind === 'rotate' ? x : kind === 'reflect' ? y : y + 7;
      out.data.set(
        im.data.slice(4 * (y * im.width + x), 4 * (y * im.width + x) + 4),
        4 * (ny * out.width + nx),
      );
    }
  return out;
}
