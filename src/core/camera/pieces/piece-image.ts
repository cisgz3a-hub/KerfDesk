// The flattened bed picture prepared for finding pieces (ADR-442): colour is
// blurred over about one honeycomb cell, so a patterned bed reads as an even
// tone and a blank as another, while straight edges keep their place. Bed
// points the camera cannot see (alpha 0) take no part: the blur is
// normalised by the visible pixels, so an unseen margin never darkens a
// piece beside it. Pure core.

import type { RgbaImage } from '../rgba-image';

export type PieceImage = {
  readonly width: number;
  readonly height: number;
  /** Blurred colour, three floats per pixel (0..255). */
  readonly rgb: Float32Array;
  /** 1 where the camera saw the bed point. */
  readonly visible: Uint8Array;
};

/** Blur radius: about half a honeycomb cell (6 mm pitch on most beds). */
export const PIECE_BLUR_RADIUS_MM = 2.5;

export function pieceImage(image: RgbaImage, pixelsPerMm: number): PieceImage {
  const { width, height } = image;
  const n = width * height;
  const { visible, planes, weight } = visiblePlanes(image);
  const radius = Math.max(1, Math.round(PIECE_BLUR_RADIUS_MM * pixelsPerMm));
  // Two box passes approximate a Gaussian closely enough to flatten the
  // cell pattern without ringing.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const plane of [...planes, weight]) boxBlur(plane, width, height, radius);
  }
  const [red, green, blue] = planes;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const w = weight[i] ?? 0;
    if (!(w > 1e-6)) continue;
    rgb[i * 3] = (red[i] ?? 0) / w;
    rgb[i * 3 + 1] = (green[i] ?? 0) / w;
    rgb[i * 3 + 2] = (blue[i] ?? 0) / w;
  }
  return { width, height, rgb, visible };
}

// The colour planes and a weight plane, 1 where the camera saw the bed.
function visiblePlanes(image: RgbaImage) {
  const n = image.width * image.height;
  const visible = new Uint8Array(n);
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  const [red, green, blue] = planes;
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if ((image.data[i * 4 + 3] ?? 0) === 0) continue;
    visible[i] = 1;
    weight[i] = 1;
    red[i] = image.data[i * 4] ?? 0;
    green[i] = image.data[i * 4 + 1] ?? 0;
    blue[i] = image.data[i * 4 + 2] ?? 0;
  }
  return { visible, planes, weight };
}

// In place: a box of side 2r+1, rows then columns, zero outside the image.
function boxBlur(plane: Float32Array, width: number, height: number, r: number): void {
  const line = new Float32Array(Math.max(width, height));
  blurLines(plane, line, height, width, 1, width, r);
  blurLines(plane, line, width, height, width, 1, r);
}

function blurLines(
  plane: Float32Array,
  line: Float32Array,
  lines: number,
  length: number,
  step: number,
  lineStride: number,
  r: number,
): void {
  const scale = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l += 1) {
    const base = l * lineStride;
    for (let i = 0; i < length; i += 1) line[i] = plane[base + i * step] ?? 0;
    let sum = 0;
    for (let i = 0; i <= Math.min(r, length - 1); i += 1) sum += line[i] ?? 0;
    for (let i = 0; i < length; i += 1) {
      plane[base + i * step] = sum * scale;
      const enter = i + r + 1;
      const leave = i - r;
      if (enter < length) sum += line[enter] ?? 0;
      if (leave >= 0) sum -= line[leave] ?? 0;
    }
  }
}
