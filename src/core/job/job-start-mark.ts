import { buildMotionManifest, type MotionPoint } from './motion-manifest';

export const JOB_START_MARK_SECONDS = 1;

export type JobStartMarkPlan = {
  readonly point: MotionPoint;
  readonly returnPosition: MotionPoint;
  readonly travelLine: string;
  /** One write queues off behind the controller dwell, without a host timer. */
  readonly pulseBatch: string;
  readonly returnLine: string;
};

/** Cartesian GRBL-family output only. The point belongs to the final program's
 * work coordinates, after placement, rounding, scan offsets and blank pixels.
 * It is the entrance to the first emitted powered motion, not a bounds anchor. */
export function buildJobStartMarkPlan(
  gcode: string,
  initialPosition: MotionPoint,
  powerS: number,
  feedMmPerMin: number,
): JobStartMarkPlan {
  if (!finitePoint(initialPosition) || !Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) {
    throw new Error('Mark job start needs a known position and a positive travel feed.');
  }
  if (!Number.isInteger(powerS) || powerS <= 0) {
    throw new Error('Mark power must resolve to a positive capped S value.');
  }
  const point = buildMotionManifest(gcode, {
    machineKind: 'laser',
    initialPosition,
  }).firstProcessPoint;
  if (point === null || !finitePoint(point)) {
    throw new Error('This program has no emitted powered motion to mark.');
  }
  if (point.z !== initialPosition.z) {
    throw new Error('Mark job start cannot reproduce a program that changes laser Z.');
  }
  const feed = Math.max(1, Math.round(feedMmPerMin));
  return {
    point,
    returnPosition: initialPosition,
    travelLine: beamOffMove(point, feed),
    pulseBatch: jobStartMarkPulseBatch(powerS, feed),
    returnLine: beamOffMove(initialPosition, feed),
  };
}

export function jobStartMarkPulseBatch(powerS: number, feedMmPerMin: number): string {
  if (!Number.isInteger(powerS) || powerS <= 0) {
    throw new Error('Mark power must resolve to a positive capped S value.');
  }
  const feed = Math.max(1, Math.round(feedMmPerMin));
  return `G1 F${feed} M3 S${powerS}\nG4 P${JOB_START_MARK_SECONDS}\nM5\n`;
}

function beamOffMove(point: MotionPoint, feed: number): string {
  // G54 has been selected/read back by the owned preparation. No axis mirror
  // or WCO translation is applied again to this already-emitted work point.
  return `G21 G90 G54 G94 G1 X${coordinate(point.x)} Y${coordinate(point.y)} F${feed} S0\n`;
}

function coordinate(value: number): string {
  // Retain an inch-reported initial head after mm conversion as well as the
  // final emitter's 3dp point; rounding the return to 3dp can lose that head.
  return value.toFixed(6);
}

function finitePoint(point: MotionPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}
