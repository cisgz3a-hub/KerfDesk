import type { RawImageData } from '../core/trace/trace-image';
export function blank(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}
export function rect(
  im: RawImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: number | number[] = 0,
) {
  const rgba = typeof colour === 'number' ? [colour, colour, colour, 255] : colour;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) im.data.set(rgba, 4 * (yy * im.width + xx));
}
export function accepted(
  kind: 'original' | 'independent',
  count: number,
  colour = [230, 190, 120, 255],
) {
  const spec =
    kind === 'original'
      ? {
          width: 128,
          roi: [15, 20, 40, 40],
          weak: [70, 70, 24, 10],
          patchX: 90,
          patchY: 20,
          columns: 8,
        }
      : {
          width: 160,
          roi: [18, 22, 36, 36],
          weak: [100, 82, 18, 10],
          patchX: 112,
          patchY: 22,
          columns: 9,
        };
  const image = blank(spec.width, 128),
    roi = spec.roi;
  rect(image, ...(roi as [number, number, number, number]));
  rect(image, ...(spec.weak as [number, number, number, number]), 180);
  for (let i = 0; i < count; i++)
    rect(
      image,
      spec.patchX + (i % spec.columns),
      spec.patchY + Math.floor(i / spec.columns),
      1,
      1,
      colour,
    );
  const foreground = new Uint8Array(image.width * image.height),
    weak = new Uint8Array(foreground.length);
  for (let i = 0; i < foreground.length; i++) {
    foreground[i] = image.data[4 * i] === 255 ? 0 : 1;
    weak[i] = foreground[i] && image.data[4 * i] !== 0 ? 1 : 0;
  }
  return {
    name: kind + '-' + count + '-' + colour.slice(0, 3).join('_'),
    image,
    roi,
    foreground,
    weak,
  };
}
type Illumination = 'pale' | 'uneven' | 'low-contrast' | 'binary';
function labelledInk(x: number, y: number) {
  return (
    (x >= 10 && x < 42 && y >= 10 && y < 42) ||
    ([60, 80, 100].some((a) => x >= a && x < a + 3) && y >= 15 && y < 75)
  );
}
function background(kind: Illumination, x: number) {
  if (kind === 'uneven') return Math.round(145 + (100 * x) / 127);
  return kind === 'low-contrast' ? 210 : 255;
}
function strokeValue(kind: Illumination, bg: number) {
  if (kind === 'binary') return 0;
  if (kind === 'pale') return 200;
  return bg - (kind === 'low-contrast' ? 14 : 24);
}
export function illuminated(kind: Illumination) {
  const image = blank(128, 96),
    foreground = new Uint8Array(128 * 96),
    weak = new Uint8Array(foreground.length);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++) {
      const bg = background(kind, x);
      const ink = labelledInk(x, y);
      const solid = ink && x < 42;
      const value = solid ? 0 : ink ? strokeValue(kind, bg) : bg;
      image.data.set(
        ink && !solid && kind !== 'binary'
          ? [value + 8, value, value - 16, 255]
          : [value, value, value, 255],
        4 * (y * 128 + x),
      );
      foreground[y * 128 + x] = ink ? 1 : 0;
      weak[y * 128 + x] = ink && !solid ? 1 : 0;
    }
  return { name: kind, image, roi: [10, 10, 32, 32], foreground, weak };
}
export function components(im: RawImageData, roi: number[], ink: boolean) {
  const [x0, y0, w, h] = roi as [number, number, number, number],
    seen = new Uint8Array(w * h),
    areas: number[] = [];
  const matches = (x: number, y: number) =>
    im.data[4 * ((y + y0) * im.width + x + x0)]! < 128 === ink;
  let enclosed = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !matches(i % w, Math.floor(i / w))) continue;
    seen[i] = 1;
    const result = component(i, w, h, seen, matches);
    areas.push(result.area);
    if (!result.edge) enclosed++;
  }
  return { areas: areas.sort((a, b) => a - b), pixels: areas.reduce((a, b) => a + b, 0), enclosed };
}
function component(
  start: number,
  w: number,
  h: number,
  seen: Uint8Array,
  matches: (x: number, y: number) => boolean,
) {
  const queue = [start];
  let edge = false;
  for (const at of queue) {
    const x = at % w,
      y = Math.floor(at / w);
    edge ||= Math.min(x, y, w - 1 - x, h - 1 - y) === 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const n = yy * w + xx;
      if (seen[n] || !matches(xx, yy)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return { area: queue.length, edge };
}
export function score(mask: RawImageData, labels: Uint8Array) {
  let tp = 0,
    fn = 0,
    fp = 0,
    tn = 0;
  for (let i = 0; i < labels.length; i++) {
    const ink = mask.data[4 * i]! < 128;
    if (labels[i]) {
      if (ink) tp++;
      else fn++;
    } else if (ink) fp++;
    else tn++;
  }
  return { tp, fn, fp, tn, recall: tp / (tp + fn), precision: tp / (tp + fp) };
}
