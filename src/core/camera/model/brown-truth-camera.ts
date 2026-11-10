// Test support (ADR-441 Amendment 9): a truth camera of another lens family
// than the one KerfDesk fits (Brown-Conrady radial k1..k3 with tangential
// p1, p2, against the fitted Kannala-Brandt model), so a calibration test
// sees the misfit a real lens gives instead of its own model handed back.
// Not shipped code.

import { rodriguesToMatrix } from '../rodrigues';
import {
  bedPoint,
  cameraCentre,
  worldToCamera,
  type CameraPose,
  type Vec2,
  type Vec3,
} from './camera-model';

export type BrownCamera = {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
  readonly k1: number;
  readonly k2: number;
  readonly k3: number;
  readonly p1: number;
  readonly p2: number;
  readonly width: number;
  readonly height: number;
  readonly pose: CameraPose;
};

function distort(c: BrownCamera, x: number, y: number): Vec2 {
  const r2 = x * x + y * y;
  const radial = 1 + c.k1 * r2 + c.k2 * r2 * r2 + c.k3 * r2 * r2 * r2;
  return {
    x: x * radial + 2 * c.p1 * x * y + c.p2 * (r2 + 2 * x * x),
    y: y * radial + c.p1 * (r2 + 2 * y * y) + 2 * c.p2 * x * y,
  };
}

/** Where `world` shows in the truth camera's picture, or null behind it. */
export function brownProject(c: BrownCamera, world: Vec3): Vec2 | null {
  const p = worldToCamera(c.pose, world);
  if (!(p.z > 1e-6)) return null;
  const d = distort(c, p.x / p.z, p.y / p.z);
  return { x: c.fx * d.x + c.cx, y: c.fy * d.y + c.cy };
}

/** The bed point the truth camera sees at `pixel`, `heightMm` above the bed. */
export function brownToBed(c: BrownCamera): (pixel: Vec2, heightMm?: number) => Vec2 | null {
  const r = rodriguesToMatrix(c.pose.rvec);
  const centre = cameraCentre(c.pose);
  return (pixel, heightMm = 0) => {
    const u = (pixel.x - c.cx) / c.fx;
    const v = (pixel.y - c.cy) / c.fy;
    // Fixed-point undistortion, then a few Newton-free refinements.
    let x = u;
    let y = v;
    for (let i = 0; i < 25; i += 1) {
      const d = distort(c, x, y);
      x += u - d.x;
      y += v - d.y;
    }
    const dx = r[0] * x + r[3] * y + r[6];
    const dy = r[1] * x + r[4] * y + r[7];
    const dz = r[2] * x + r[5] * y + r[8];
    if (Math.abs(dz) < 1e-9) return null;
    const s = (-heightMm - centre.z) / dz;
    if (!(s > 0)) return null;
    return { x: centre.x + s * dx, y: centre.y + s * dy };
  };
}

/**
 * The true overlay error at bed point `at` (`heightMm` up): the saved model
 * draws it at its own pixel for it, where the truth camera shows another point.
 */
export function trueOverlayErrorMm(
  truth: BrownCamera,
  modelPixel: (world: Vec3) => Vec2 | null,
  at: Vec2,
  heightMm: number,
): number | null {
  const pixel = modelPixel(bedPoint(at.x, at.y, heightMm));
  if (pixel === null) return null;
  if (pixel.x < 0 || pixel.y < 0 || pixel.x > truth.width - 1 || pixel.y > truth.height - 1)
    return null;
  const seen = brownToBed(truth)(pixel, heightMm);
  return seen === null ? null : Math.hypot(seen.x - at.x, seen.y - at.y);
}
