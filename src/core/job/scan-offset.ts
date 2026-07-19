// scan-offset — bidirectional firing-lag compensation (the "zipper" cancel).
//
// A laser's on/off + power response lags the motion planner by a roughly fixed
// TIME. At feed that time becomes a fixed DISTANCE that flips sign on each
// alternating fill/raster row (snake order), so a vertical edge lands at two
// alternating positions — the serration ADR-038 names the "zipper" (Cause C of
// docs/research/burn-perfection-small-text.md). ADR-038 added a unidirectional
// toggle that removes the zipper by giving up bidirectional speed; this module is
// the *compensation* path ADR-038 deferred: keep snake speed, but slide each
// reverse row back along its own travel by a calibrated, speed-dependent amount
// so the two directions register. See ADR-052.
//
// Two pure pieces, deliberately split from any emitter so Fill and Image (raster)
// share one implementation and so the geometry is testable without G-code:
//   - offsetForSpeed: interpolate the per-device calibration table at a feed.
//   - shiftAlongTravel: translate a sweep along ITS OWN direction vector, so the
//     correction is correct at any hatch angle, not just axis-aligned rows.
//
// Pure-core: no clock, no random, no I/O. Same input -> same output (determinism
// invariant #5). The GRBL fill/raster emitters import this, but an empty device
// table still returns 0 so uncalibrated machines keep byte-identical output.

import type { DeviceProfile, ScanOffsetPoint } from '../devices';
import type { Vec2 } from '../scene';
export type { ScanOffsetPoint } from '../devices';

export function validatedScanOffsetMm(
  _device: DeviceProfile,
  offsetMm: number | undefined,
): number | undefined {
  if (offsetMm === undefined) return undefined;
  if (!Number.isFinite(offsetMm)) {
    throw new RangeError(`Bidirectional scan offset ${String(offsetMm)} mm must be finite.`);
  }
  return offsetMm;
}

/**
 * One calibration sample: the measured forward-vs-reverse row separation
 * (`offsetMm`) at a given engrave feed (`speedMmPerMin`). A device holds an
 * array of these sorted ascending by speed; an empty array disables the feature
 * (every lookup returns 0, so output stays byte-identical).
 * Interpolate the scan-offset for `speedMmPerMin` from a calibration `table`.
 *
 * Contract: `table` is sorted ascending by `speedMmPerMin`. Behaviour off the
 * ends is defined here (LightBurn leaves it implementation-specific):
 *   - at/below the first point: linear from rest, `(speed / s0) * offset0`,
 *     because lag distance is ~proportional to speed and so vanishes at 0;
 *   - at/above the last point: clamped to the last offset (no wild extrapolation);
 *   - empty table or non-positive speed: 0 (feature off / no motion -> no lag).
 */
export function offsetForSpeed(
  table: ReadonlyArray<ScanOffsetPoint>,
  speedMmPerMin: number,
): number {
  if (speedMmPerMin <= 0) return 0;
  const first = table[0];
  if (first === undefined) return 0;
  if (speedMmPerMin <= first.speedMmPerMin) {
    return first.speedMmPerMin <= 0
      ? first.offsetMm
      : (speedMmPerMin / first.speedMmPerMin) * first.offsetMm;
  }
  let lo = first;
  for (let i = 1; i < table.length; i += 1) {
    const hi = table[i];
    if (hi === undefined) break;
    if (speedMmPerMin <= hi.speedMmPerMin) {
      const span = hi.speedMmPerMin - lo.speedMmPerMin;
      if (span <= 0) return hi.offsetMm;
      const t = (speedMmPerMin - lo.speedMmPerMin) / span;
      return lo.offsetMm + t * (hi.offsetMm - lo.offsetMm);
    }
    lo = hi;
  }
  return lo.offsetMm;
}

/**
 * Translate a sweep's endpoints by `offsetMm` along its own travel direction
 * (`from` -> `to`). Applied to reverse rows only, this slides the lagging row
 * back into registration with the forward rows; because the shift follows the
 * travel vector, it stays correct at any hatch angle. Returns the inputs
 * unchanged when there is nothing to do (zero offset or zero-length sweep).
 */
export function shiftAlongTravel(
  from: Vec2,
  to: Vec2,
  offsetMm: number,
): { readonly from: Vec2; readonly to: Vec2 } {
  if (offsetMm === 0) return { from, to };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { from, to };
  const shiftX = (dx / length) * offsetMm;
  const shiftY = (dy / length) * offsetMm;
  return {
    from: { x: from.x + shiftX, y: from.y + shiftY },
    to: { x: to.x + shiftX, y: to.y + shiftY },
  };
}

type SweepSpan = { readonly start: Vec2; readonly end: Vec2 };

export function shiftedScanSweepEndpoints(
  first: SweepSpan,
  last: SweepSpan,
  reverse: boolean,
  offsetMm: number,
): { readonly start: Vec2; readonly end: Vec2 } {
  if (!reverse || offsetMm === 0) return { start: first.start, end: last.end };
  return {
    start: shiftAlongTravel(first.start, first.end, offsetMm).from,
    end: shiftAlongTravel(last.start, last.end, offsetMm).to,
  };
}
