// X-corner (checkerboard saddle-point) candidate detection (ADR-106, v2.b).
//
// At a checkerboard inner corner the intensity around a small ring alternates
// dark/light twice per revolution: samples 90° apart are OPPOSITE and samples
// 180° apart are EQUAL. A plain edge also has equal opposite samples but no
// 90° alternation, so the response
//   R = Σ |s(i) + s(i+8) − s(i+4) − s(i+12)|  (alternation, over a 16-sample ring)
//     − Σ |s(i) − s(i+8)|                      (edge penalty: opposite mismatch)
// is large only at X-corners. This is the centrosymmetry family of detectors
// (ChESS); reimplemented clean-room from the geometric argument above.
// Pure core: intensity buffer in, candidate list out. Deterministic.

import type { GrayImage } from './corner-subpix';

/** A candidate corner: integer pixel position plus its detector response. */
export type CornerCandidate = {
  readonly x: number;
  readonly y: number;
  readonly strength: number;
};

// 16 ring offsets at radius ~3px, one per 22.5°, quantized to integer taps.
// Index i and i+8 are diametrically opposite; i and i+4 are 90° apart.
const RING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [3, 0],
  [3, 1],
  [2, 2],
  [1, 3],
  [0, 3],
  [-1, 3],
  [-2, 2],
  [-3, 1],
  [-3, 0],
  [-3, -1],
  [-2, -2],
  [-1, -3],
  [0, -3],
  [1, -3],
  [2, -2],
  [3, -1],
] as const;
const RING_RADIUS = 3;
const RING_QUARTER = 4;
const RING_HALF = 8;

// Candidates below this fraction of the frame's peak response are noise.
const RELATIVE_STRENGTH_FLOOR = 0.2;
// Non-max suppression radius: two corners can never be closer than this.
const NMS_RADIUS = 5;

function sampleAt(img: GrayImage, x: number, y: number): number {
  return img.data[y * img.width + x] ?? 0;
}

// The alternation-minus-edge ring response at (x, y); callers keep x/y inside
// the ring margin so every tap lands in-frame.
function ringResponse(img: GrayImage, x: number, y: number): number {
  let alternation = 0;
  let edgeMismatch = 0;
  for (let i = 0; i < RING_QUARTER; i += 1) {
    const a = ringSample(img, x, y, i);
    const b = ringSample(img, x, y, i + RING_QUARTER);
    const c = ringSample(img, x, y, i + RING_HALF);
    const d = ringSample(img, x, y, i + RING_HALF + RING_QUARTER);
    alternation += Math.abs(a + c - b - d);
  }
  for (let i = 0; i < RING_HALF; i += 1) {
    edgeMismatch += Math.abs(ringSample(img, x, y, i) - ringSample(img, x, y, i + RING_HALF));
  }
  return alternation - edgeMismatch;
}

function ringSample(img: GrayImage, x: number, y: number, index: number): number {
  const offset = RING_OFFSETS[index % RING_OFFSETS.length] ?? [0, 0];
  return sampleAt(img, x + offset[0], y + offset[1]);
}

/**
 * Find X-corner candidates: ring response over the frame, then non-max
 * suppression, then a relative-strength floor. Returns candidates sorted
 * strongest-first (deterministic tie-break on position).
 */
export function findCornerCandidates(img: GrayImage): CornerCandidate[] {
  const response = responseMap(img);
  const peaks = nonMaxSuppress(img, response);
  const strongest = peaks.reduce((max, c) => Math.max(max, c.strength), 0);
  if (strongest <= 0) return [];
  const floor = strongest * RELATIVE_STRENGTH_FLOOR;
  return peaks
    .filter((c) => c.strength >= floor)
    .sort((a, b) => b.strength - a.strength || a.y - b.y || a.x - b.x);
}

function responseMap(img: GrayImage): Float32Array {
  const map = new Float32Array(img.width * img.height);
  const margin = RING_RADIUS;
  for (let y = margin; y < img.height - margin; y += 1) {
    for (let x = margin; x < img.width - margin; x += 1) {
      const r = ringResponse(img, x, y);
      if (r > 0) map[y * img.width + x] = r;
    }
  }
  return map;
}

function nonMaxSuppress(img: GrayImage, response: Float32Array): CornerCandidate[] {
  const peaks: CornerCandidate[] = [];
  for (let y = NMS_RADIUS; y < img.height - NMS_RADIUS; y += 1) {
    for (let x = NMS_RADIUS; x < img.width - NMS_RADIUS; x += 1) {
      const value = response[y * img.width + x] ?? 0;
      if (value > 0 && isLocalMax(img.width, response, x, y, value)) {
        peaks.push({ x, y, strength: value });
      }
    }
  }
  return peaks;
}

function isLocalMax(
  width: number,
  response: Float32Array,
  x: number,
  y: number,
  value: number,
): boolean {
  for (let dy = -NMS_RADIUS; dy <= NMS_RADIUS; dy += 1) {
    for (let dx = -NMS_RADIUS; dx <= NMS_RADIUS; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const other = response[(y + dy) * width + (x + dx)] ?? 0;
      // Strict > for the raster-order winner so exact-tie plateaus keep one peak.
      if (other > value || (other === value && (dy < 0 || (dy === 0 && dx < 0)))) return false;
    }
  }
  return true;
}
