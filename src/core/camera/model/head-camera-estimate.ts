// How far a head camera's picture may be off in the band the stitch uses
// (ADR-441 Amendment 11, camera audit v2 K1-P3-1). A head camera is
// calibrated on a small target in the middle of its picture, so its ring
// figures read 0.00-0.01 mm, while the middle 80 % of the picture, which the
// stitch uses, was up to 3.8 mm off on a tilted barrel lens. The same estimate
// as a fixed camera's past its rings, over that band of the picture instead of
// the bed outside a target. Pure core.

import { bedMapper, type Vec2 } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import {
  alternativeLenses,
  awayFromRings,
  floorAt,
  observedRings,
  ringSupport,
  spreadAt,
} from './extrapolation-estimate';
import { HEAD_CAMERA_USABLE_FRACTION } from './head-camera';

// Fewer rings than this leave too little to refit halves of.
const MIN_RINGS = 12;
// Sample points across the band's width; its height follows the picture's shape.
const BAND_STEPS = 24;

const cache = new Map<string, number | null>();

/** The largest estimated error in the used band of a head camera's picture, mm, or null. */
export function headCameraBandEstimateMm(record: CameraModelRecord): number | null {
  if (record.mount?.kind !== 'head') return null;
  const key = JSON.stringify([
    record.calibratedAt,
    record.lens,
    record.pose,
    record.accuracy.marks ?? [],
  ]);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const estimate = bandEstimate(record);
  if (cache.size > 16) cache.clear();
  cache.set(key, estimate);
  return estimate;
}

function bandEstimate(record: CameraModelRecord): number | null {
  const points = observedRings(record);
  if (points.length < MIN_RINGS) return null;
  const alternatives = alternativeLenses(record, points);
  if (alternatives.length === 0) return null;
  const { lens, pose } = record;
  const height = record.accuracy.targetHeightMm;
  const saved = bedMapper(lens, pose);
  const support = ringSupport(lens, points);
  let worst = 0;
  for (const pixel of bandPixels(lens.imageWidth, lens.imageHeight)) {
    const at = saved(pixel, height);
    if (at === null) continue;
    const floor = floorAt(lens, saved, pixel, at, height, support.radiusPx);
    const spread = spreadAt(alternatives, pixel, at, height) * awayFromRings(at, support);
    worst = Math.max(worst, spread, floor);
  }
  return worst;
}

// A grid over the middle of the picture the stitch uses.
function bandPixels(width: number, height: number): Vec2[] {
  const margin = (1 - HEAD_CAMERA_USABLE_FRACTION) / 2;
  const x0 = margin * (width - 1);
  const y0 = margin * (height - 1);
  const w = HEAD_CAMERA_USABLE_FRACTION * (width - 1);
  const h = HEAD_CAMERA_USABLE_FRACTION * (height - 1);
  const rows = Math.max(2, Math.round((BAND_STEPS * h) / w));
  const pixels: Vec2[] = [];
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= BAND_STEPS; i += 1) {
      pixels.push({ x: x0 + (i * w) / BAND_STEPS, y: y0 + (j * h) / rows });
    }
  }
  return pixels;
}
