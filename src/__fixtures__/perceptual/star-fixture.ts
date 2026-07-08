// Shared filled-star fixture for trace apex-fidelity tests. A 12-tip star,
// outer radius 80, inner radius 45, centered at (100,100) in a 200x200 image.
// Its outer tips subtend ~27deg, sharp enough that rasterization +
// polygonization blunt them, so tracers that do not reconstruct the apex
// land ~2-3px short (the edge-trace apex-snap test uses this fixture).

import type { RawImageData } from '../../core/trace/trace-image';
import type { Vec2 } from '../../core/scene';

const STAR_TIPS = 12;
const STAR_CENTER = 100;
const STAR_OUTER_R = 80;
const STAR_INNER_R = 45;
const STAR_SIZE = 200;

/** The 12 analytic outer-tip apex points (the convex corners a tracer should reach). */
export function starOuterTips(): Vec2[] {
  const tips: Vec2[] = [];
  for (let tip = 0; tip < STAR_TIPS; tip += 1) {
    const angle = ((tip * 2) / (STAR_TIPS * 2)) * 2 * Math.PI;
    tips.push({
      x: STAR_CENTER + STAR_OUTER_R * Math.cos(angle),
      y: STAR_CENTER + STAR_OUTER_R * Math.sin(angle),
    });
  }
  return tips;
}

/** All 24 star corners (outer tips and inner valleys, alternating), used as the fill polygon. */
export function starCorners(): Vec2[] {
  const corners: Vec2[] = [];
  for (let k = 0; k < STAR_TIPS * 2; k += 1) {
    const angle = (k / (STAR_TIPS * 2)) * 2 * Math.PI;
    const radius = k % 2 === 0 ? STAR_OUTER_R : STAR_INNER_R;
    corners.push({
      x: STAR_CENTER + radius * Math.cos(angle),
      y: STAR_CENTER + radius * Math.sin(angle),
    });
  }
  return corners;
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** The filled star rasterized onto a white RGBA background (ink = luma 0). */
export function filledStarImage(): RawImageData {
  const corners = starCorners();
  const data = new Uint8ClampedArray(STAR_SIZE * STAR_SIZE * 4);
  for (let y = 0; y < STAR_SIZE; y += 1) {
    for (let x = 0; x < STAR_SIZE; x += 1) {
      const v = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, corners) ? 0 : 255;
      const o = (y * STAR_SIZE + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: STAR_SIZE, height: STAR_SIZE, data };
}
