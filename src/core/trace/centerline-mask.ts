import type { RawImageData } from './trace-image';

const INK_THRESHOLD = 128;

export function centerlineMaskFromImage(image: RawImageData): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i += 1) {
    const offset = i * 4;
    const alpha = image.data[offset + 3] ?? 255;
    if (alpha === 0) continue;
    const r = image.data[offset] ?? 255;
    const g = image.data[offset + 1] ?? 255;
    const b = image.data[offset + 2] ?? 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    mask[i] = luma < INK_THRESHOLD ? 1 : 0;
  }
  return mask;
}

export function thinMask(input: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(input);
  if (width < 3 || height < 3) return mask;
  let changed = true;
  while (changed) {
    changed = thinStep(mask, width, height, 0);
    changed = thinStep(mask, width, height, 1) || changed;
  }
  return mask;
}

function thinStep(mask: Uint8Array, width: number, height: number, phase: 0 | 1): boolean {
  const remove: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = indexOf(x, y, width);
      if (mask[idx] !== 1) continue;
      if (shouldRemove(mask, width, x, y, phase)) remove.push(idx);
    }
  }
  for (const idx of remove) mask[idx] = 0;
  return remove.length > 0;
}

function shouldRemove(
  mask: Uint8Array,
  width: number,
  x: number,
  y: number,
  phase: 0 | 1,
): boolean {
  const n = orderedNeighbors(mask, width, x, y);
  const count = n.reduce((sum, v) => sum + v, 0);
  if (count < 2 || count > 6) return false;
  if (transitionCount(n) !== 1) return false;
  const [p2 = 0, , p4 = 0, , p6 = 0, , p8 = 0] = n;
  if (phase === 0) return p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0;
  return p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;
}

function orderedNeighbors(mask: Uint8Array, width: number, x: number, y: number): number[] {
  return [
    mask[indexOf(x, y - 1, width)] ?? 0,
    mask[indexOf(x + 1, y - 1, width)] ?? 0,
    mask[indexOf(x + 1, y, width)] ?? 0,
    mask[indexOf(x + 1, y + 1, width)] ?? 0,
    mask[indexOf(x, y + 1, width)] ?? 0,
    mask[indexOf(x - 1, y + 1, width)] ?? 0,
    mask[indexOf(x - 1, y, width)] ?? 0,
    mask[indexOf(x - 1, y - 1, width)] ?? 0,
  ];
}

function transitionCount(neighbors: ReadonlyArray<number>): number {
  let count = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    const a = neighbors[i] ?? 0;
    const b = neighbors[(i + 1) % neighbors.length] ?? 0;
    if (a === 0 && b === 1) count += 1;
  }
  return count;
}

function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}
