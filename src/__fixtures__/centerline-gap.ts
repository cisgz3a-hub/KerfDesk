import type { RawImageData } from '../core/trace/trace-image';
export function white(width = 128, height = width): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}
export function rect(image: RawImageData, x: number, y: number, w: number, h: number) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) image.data.set([0, 0, 0, 255], 4 * (yy * image.width + xx));
}
export function gapFixture(
  kind: 'original' | 'independent' = 'original',
  broad = false,
): RawImageData {
  const image = kind === 'original' ? white() : white(144, 152);
  if (kind === 'original') {
    rect(image, 18, 64, 42, 1);
    rect(image, 61, 64, 49, 1);
    if (broad) rect(image, 18, 15, 92, 20);
  } else {
    rect(image, 89, 18, 1, 47);
    rect(image, 89, 66, 1, 62);
    if (broad) rect(image, 15, 18, 20, 110);
  }
  return image;
}
export function line(
  image: RawImageData,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const t = l ? Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / l)) : 0;
      if (Math.hypot(x + 0.5 - a.x - t * dx, y + 0.5 - a.y - t * dy) <= radius)
        rect(image, x, y, 1, 1);
    }
}
export function controlFixture(kind: 'parallel' | 'intentional' | 'branch' | 'ring'): RawImageData {
  const image = white();
  if (kind === 'parallel') {
    rect(image, 18, 61, 92, 1);
    rect(image, 18, 65, 92, 1);
  }
  if (kind === 'intentional') {
    rect(image, 18, 64, 42, 1);
    rect(image, 66, 64, 44, 1);
  }
  if (kind === 'branch')
    for (const p of [
      { x: 24.5, y: 22.5 },
      { x: 104.5, y: 22.5 },
      { x: 64.5, y: 109.5 },
    ])
      line(image, { x: 64.5, y: 64.5 }, p, 3);
  if (kind === 'ring')
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++)
        if (Math.abs(Math.hypot(x + 0.5 - 64.5, y + 0.5 - 64.5) - 28) <= 3) rect(image, x, y, 1, 1);
  return image;
}
