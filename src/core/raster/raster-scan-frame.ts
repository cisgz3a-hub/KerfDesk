// An image scanned at an angle (ADR-492).
//
// A raster group's pixel grid, bounds, rows, overscan, dot width correction
// and bidirectional scan offset all live in its SCAN FRAME, whose +X axis is
// the scan direction and whose +Y axis steps from row to row. A scan-frame
// point reaches machine coordinates by a rotation about the machine origin by
// the scan angle, counter-clockwise in machine coordinates: the same sense a
// Fill's hatch angle has, so the same number scans an image and hatches a
// shape the same way on the bed.
//
// Because every per-row quantity is measured along the scan direction, the
// scan offset stays along the head's travel at every angle, and the overscan
// runway sits on the scan line before and after each sweep. At 0 degrees the
// scan frame IS the machine frame and nothing is rotated, so historical
// output is unchanged byte for byte.

import type { Vec2 } from '../scene';

export type RasterScanFrame = {
  /** Scan direction in degrees, in [0, 180). 0 scans along machine X. */
  readonly angleDeg: number;
  readonly cos: number;
  readonly sin: number;
};

export type ScanRect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export const ALONG_X_SCAN_FRAME: RasterScanFrame = { angleDeg: 0, cos: 1, sin: 0 };

const HALF_TURN_DEG = 180;
const DEG_TO_RAD = Math.PI / 180;
const TRIG_EPS = 1e-12;

/** A scan angle folded into [0, 180); rows at a and a + 180 are the same rows. */
export function normalizedScanAngleDeg(deg: number | undefined): number {
  if (deg === undefined || !Number.isFinite(deg)) return 0;
  const folded = deg % HALF_TURN_DEG;
  const angle = folded < 0 ? folded + HALF_TURN_DEG : folded;
  // -0 and a remainder that rounds onto 180 both mean along X.
  return angle === 0 || angle === HALF_TURN_DEG ? 0 : angle;
}

export function rasterScanFrame(angleDeg: number | undefined): RasterScanFrame {
  const angle = normalizedScanAngleDeg(angleDeg);
  if (angle === 0) return ALONG_X_SCAN_FRAME;
  const rad = angle * DEG_TO_RAD;
  // Snapped like the hatch rotation, so 90 degrees scans along Y exactly.
  return { angleDeg: angle, cos: snapTrig(Math.cos(rad)), sin: snapTrig(Math.sin(rad)) };
}

export function isAlongXScan(frame: RasterScanFrame): boolean {
  return frame.angleDeg === 0;
}

export function scanToMachine(frame: RasterScanFrame, p: Vec2): Vec2 {
  if (isAlongXScan(frame)) return p;
  return { x: p.x * frame.cos - p.y * frame.sin, y: p.x * frame.sin + p.y * frame.cos };
}

export function machineToScan(frame: RasterScanFrame, p: Vec2): Vec2 {
  if (isAlongXScan(frame)) return p;
  return { x: p.x * frame.cos + p.y * frame.sin, y: -p.x * frame.sin + p.y * frame.cos };
}

/** The four corners of a scan-frame rectangle, in machine coordinates. */
export function scanRectMachineCorners(frame: RasterScanFrame, rect: ScanRect): Vec2[] {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ].map((corner) => scanToMachine(frame, corner));
}

/** The axis-aligned box, in the scan frame, around machine-coordinate points. */
export function scanFrameBoundsOf(frame: RasterScanFrame, points: ReadonlyArray<Vec2>): ScanRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const p = machineToScan(frame, point);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function snapTrig(n: number): number {
  if (Math.abs(n) < TRIG_EPS) return 0;
  if (Math.abs(n - 1) < TRIG_EPS) return 1;
  if (Math.abs(n + 1) < TRIG_EPS) return -1;
  return n;
}
