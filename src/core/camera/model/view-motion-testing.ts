// Test support for the camera-moved check (ADR-663 Amendment 5): the bed plane
// and what lies around it, seen through a lens and pose, so a camera that
// rolls, tips or slides can be rendered and its true overlay error measured.
// Not shipped code.

import type { Mat3 } from '../homography';
import { rodriguesToMatrix, rotationToRvec } from '../rodrigues';
import type { RgbaImage } from '../rgba-image';
import {
  bedMapper,
  bedPoint,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
  type Vec2,
} from './camera-model';

const BED_MM = 400;
// Beyond this far outside the bed the surround is a plain wall.
const SURROUND_MM = 320;

function hash(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Blocks and rails around the bed, `material` on it, a plain wall far out; a
 * dark gantry beam across everything at `gantryY` when given; `gain` for a
 * brighter room; `plain` for a surround with nothing on it. */
export function machineScene(
  material: (x: number, y: number) => number,
  options: { readonly gantryY?: number; readonly gain?: number; readonly plain?: boolean } = {},
) {
  const gain = options.gain ?? 1;
  return (x: number, y: number): number => {
    if (underGantry(x, y, options.gantryY)) return 20 * gain;
    if (x >= -5 && y >= -5 && x <= BED_MM + 5 && y <= BED_MM + 5) return material(x, y) * gain;
    return options.plain === true ? 128 * gain : Math.min(255, surround(x, y) * gain);
  };
}

function underGantry(x: number, y: number, gantryY: number | undefined): boolean {
  return gantryY !== undefined && Math.abs(y - gantryY) < 18 && x > -120 && x < 520;
}

function surround(x: number, y: number): number {
  const far = Math.max(-x, -y, x - BED_MM, y - BED_MM) > SURROUND_MM;
  if (far) return 128;
  if (Math.abs(x + 20) < 6 || Math.abs(x - BED_MM - 20) < 6) return 235;
  if (Math.abs(y + 25) < 5) return 30;
  return 50 + 170 * hash(Math.floor(x / 17), Math.floor(y / 13));
}

export const plainSheet = (): number => 200;
export const cutParts = (x: number, y: number): number =>
  (Math.floor(x / 23) + Math.floor(y / 19)) % 2 ? 45 : 215;

/** Render `scene` (bed mm → grey) through `lens` at `pose`. */
export function renderView(
  lens: LensModel,
  pose: CameraPose,
  scene: (x: number, y: number) => number,
): RgbaImage {
  const { imageWidth: width, imageHeight: height } = lens;
  const toBed = bedMapper(lens, pose);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bed = toBed({ x, y }, 0);
      // A ray that misses the plane sees the plain wall.
      const v = bed === null ? 128 : scene(bed.x, bed.y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** The camera turned by `degrees` about its own x (tip), y (pan) or z (roll) axis, staying where it is. */
export function turnedPose(pose: CameraPose, axis: 'x' | 'y' | 'z', degrees: number): CameraPose {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const turn: Mat3 =
    axis === 'x'
      ? [1, 0, 0, 0, c, -s, 0, s, c]
      : axis === 'y'
        ? [c, 0, s, 0, 1, 0, -s, 0, c]
        : [c, -s, 0, s, c, 0, 0, 0, 1];
  const r = rodriguesToMatrix(pose.rvec);
  const [tx, ty, tz] = pose.tvec;
  return {
    rvec: rotationToRvec(multiply(turn, r)),
    tvec: [
      turn[0] * tx + turn[1] * ty + turn[2] * tz,
      turn[3] * tx + turn[4] * ty + turn[5] * tz,
      turn[6] * tx + turn[7] * ty + turn[8] * tz,
    ],
  };
}

/** The camera slid by `dx`, `dy` mm along the bed, keeping its direction. */
export function slidPose(pose: CameraPose, dx: number, dy: number): CameraPose {
  const r = rodriguesToMatrix(pose.rvec);
  const [tx, ty, tz] = pose.tvec;
  return {
    rvec: pose.rvec,
    tvec: [
      tx - (r[0] * dx + r[1] * dy),
      ty - (r[3] * dx + r[4] * dy),
      tz - (r[6] * dx + r[7] * dy),
    ],
  };
}

/** The true overlay error at `points` once the camera moved from `before` to `after`, mm. */
export function trueBedErrorsMm(
  lens: LensModel,
  before: CameraPose,
  after: CameraPose,
  points: ReadonlyArray<Vec2>,
): number[] {
  const seenNow = bedMapper(lens, after);
  return points.map((p) => {
    const pixel = projectWorldPoint(lens, before, bedPoint(p.x, p.y));
    const now = pixel === null ? null : seenNow(pixel, 0);
    return now === null ? Number.POSITIVE_INFINITY : Math.hypot(now.x - p.x, now.y - p.y);
  });
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += (a[i * 3 + k] ?? 0) * (b[k * 3 + j] ?? 0);
      out[i * 3 + j] = sum;
    }
  }
  return out as unknown as Mat3;
}
