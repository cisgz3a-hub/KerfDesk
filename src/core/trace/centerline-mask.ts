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

// Zhang-Suen thinning, allocation-free: inline 8-neighbour reads (no per-pixel
// array) and one reused removal buffer instead of a fresh array each pass. The
// removal logic is byte-for-byte the same, so the skeleton is identical to the
// previous implementation — this is purely the GC-thrash fix behind the
// big-image lag (ADR-058 2b). A full-image scan per pass remains; a frontier
// queue is the follow-up if that becomes the bottleneck.
export function thinMask(input: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(input);
  if (width < 3 || height < 3) return mask;
  // Iterate only the ink pixels (a compacting active list), not the whole grid —
  // each pass touches O(ink) not O(W·H), and the list shrinks as the stroke
  // thins. Removals are still computed from the start-of-pass state and applied
  // after, so the skeleton is byte-identical to a full-grid Zhang-Suen scan.
  let ink = collectInteriorInk(mask, width, height);
  const removeBuf = new Int32Array(ink.length);
  let changed = true;
  while (changed && ink.length > 0) {
    const removed0 = thinPass(mask, width, ink, removeBuf, 0);
    const removed1 = thinPass(mask, width, ink, removeBuf, 1);
    changed = removed0 || removed1;
    if (changed) ink = compactInk(mask, ink);
  }
  return mask;
}

function thinPass(
  mask: Uint8Array,
  width: number,
  ink: Int32Array,
  removeBuf: Int32Array,
  phase: 0 | 1,
): boolean {
  let count = 0;
  for (const idx of ink) {
    if (mask[idx] !== 1) continue;
    if (shouldRemove(mask, width, idx, phase)) {
      removeBuf[count] = idx;
      count += 1;
    }
  }
  for (let k = 0; k < count; k += 1) {
    const idx = removeBuf[k];
    if (idx !== undefined) mask[idx] = 0;
  }
  return count > 0;
}

function collectInteriorInk(mask: Uint8Array, width: number, height: number): Int32Array {
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) if (mask[indexOf(x, y, width)] === 1) count += 1;
  }
  const out = new Int32Array(count);
  let k = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = indexOf(x, y, width);
      if (mask[idx] === 1) {
        out[k] = idx;
        k += 1;
      }
    }
  }
  return out;
}

function compactInk(mask: Uint8Array, ink: Int32Array): Int32Array {
  let count = 0;
  for (const idx of ink) {
    if (mask[idx] === 1) count += 1;
  }
  const out = new Int32Array(count);
  let k = 0;
  for (const idx of ink) {
    if (mask[idx] === 1) {
      out[k] = idx;
      k += 1;
    }
  }
  return out;
}

// Zhang-Suen removal test, inline neighbour reads in p2..p9 order
// (N, NE, E, SE, S, SW, W, NW). `idx` is the pixel's flat index; callers pass
// only interior pixels (1..height-2, 1..width-2) so neighbours stay in-bounds.
function shouldRemove(mask: Uint8Array, width: number, idx: number, phase: 0 | 1): boolean {
  const p2 = at(mask, idx - width);
  const p3 = at(mask, idx - width + 1);
  const p4 = at(mask, idx + 1);
  const p5 = at(mask, idx + width + 1);
  const p6 = at(mask, idx + width);
  const p7 = at(mask, idx + width - 1);
  const p8 = at(mask, idx - 1);
  const p9 = at(mask, idx - width - 1);
  const count = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
  if (count < 2 || count > 6) return false;
  const transitions =
    trans(p2, p3) +
    trans(p3, p4) +
    trans(p4, p5) +
    trans(p5, p6) +
    trans(p6, p7) +
    trans(p7, p8) +
    trans(p8, p9) +
    trans(p9, p2);
  if (transitions !== 1) return false;
  if (phase === 0) return p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0;
  return p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;
}

function at(mask: Uint8Array, i: number): number {
  return mask[i] ?? 0;
}

function trans(a: number, b: number): number {
  return a === 0 && b === 1 ? 1 : 0;
}

function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}
