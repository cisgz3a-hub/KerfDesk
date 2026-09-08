import type { RawImageData } from '../core/trace/trace-image';
export function denseFixture(kind: 'original' | 'independent' = 'original'): RawImageData {
  const spec =
    kind === 'original'
      ? { width: 1601, height: 1000, barsX: 8, barsY: 20, barsH: 960, targetX: 1000, targetY: 60 }
      : { width: 1603, height: 997, barsX: 12, barsY: 18, barsH: 956, targetX: 1003, targetY: 63 };
  const data = new Uint8ClampedArray(spec.width * spec.height * 4).fill(255);
  for (let i = 3; i < data.length; i += 4) data[i] = 0;
  const image = { width: spec.width, height: spec.height, data };
  for (let x = spec.barsX; x < spec.barsX + 800; x += 8)
    rect(image, x, spec.barsY, 4, spec.barsH, [20, 80, 180, 255]);
  for (let n = 0; n < 12; n++)
    rect(image, spec.targetX + n * 40, spec.targetY, 5, 5, [0, 0, 0, 255]);
  return image;
}
export function rect(
  im: RawImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  rgba = [0, 0, 0, 255],
) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) im.data.set(rgba, 4 * (yy * im.width + xx));
}
