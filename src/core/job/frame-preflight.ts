// framePreflight — guards the F-B4 Frame action against off-bed travel.
//
// Without this check, framing a design whose AABB extends past the bed
// sends `$J=...` jog commands to coordinates the machine can't reach.
// On controllers with $20 soft-limits disabled (common default on
// hobby diode lasers including the Creality Falcon), the steppers
// slam into the physical end-stops and skip steps — the operator
// hears the grinding and the trace looks "sideways" because one axis
// stops while the other keeps moving.
//
// Pure: bounds + device dimensions in, Result out. The G-code path
// uses `bounds-check` for the same reason during job preflight;
// keeping Frame's check separate (and equally strict) so a job that
// would fail preflight can't first trash the machine via Frame.

import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import type { JobBounds } from './job-bounds';

// 1 µm slop — bed dimensions and bounds are both in mm to ~6 decimals,
// so anything tighter than this is float noise, not a real overhang.
const EPSILON_MM = 0.001;

export type FramePreflight =
  | { readonly kind: 'ok' }
  | { readonly kind: 'no-go-zone'; readonly zoneName: string }
  | {
      readonly kind: 'out-of-bounds';
      readonly bounds: JobBounds;
      readonly bed: { readonly width: number; readonly height: number };
      readonly overhang: {
        readonly minX: number;
        readonly minY: number;
        readonly maxX: number;
        readonly maxY: number;
      };
    };

export function framePreflight(bounds: JobBounds, device: DeviceProfile): FramePreflight {
  const machineBounds = machineBoundsForDevice(device);
  const overhang = {
    minX: Math.max(0, machineBounds.minX - bounds.minX),
    minY: Math.max(0, machineBounds.minY - bounds.minY),
    maxX: Math.max(0, bounds.maxX - machineBounds.maxX),
    maxY: Math.max(0, bounds.maxY - machineBounds.maxY),
  };
  const off =
    overhang.minX > EPSILON_MM ||
    overhang.minY > EPSILON_MM ||
    overhang.maxX > EPSILON_MM ||
    overhang.maxY > EPSILON_MM;
  if (off) {
    return {
      kind: 'out-of-bounds',
      bounds,
      bed: { width: device.bedWidth, height: device.bedHeight },
      overhang,
    };
  }
  const hit = device.noGoZones.find((zone) => zone.enabled && frameIntersectsZone(bounds, zone));
  if (hit !== undefined) return { kind: 'no-go-zone', zoneName: hit.name };
  return { kind: 'ok' };
}

function frameIntersectsZone(
  bounds: JobBounds,
  zone: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): boolean {
  const zoneMaxX = zone.x + zone.width;
  const zoneMaxY = zone.y + zone.height;
  const top = horizontalIntersects(
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    zone.x,
    zoneMaxX,
    zone.y,
    zoneMaxY,
  );
  const bottom = horizontalIntersects(
    bounds.minX,
    bounds.maxX,
    bounds.maxY,
    zone.x,
    zoneMaxX,
    zone.y,
    zoneMaxY,
  );
  const left = verticalIntersects(
    bounds.minY,
    bounds.maxY,
    bounds.minX,
    zone.y,
    zoneMaxY,
    zone.x,
    zoneMaxX,
  );
  const right = verticalIntersects(
    bounds.minY,
    bounds.maxY,
    bounds.maxX,
    zone.y,
    zoneMaxY,
    zone.x,
    zoneMaxX,
  );
  return top || bottom || left || right;
}

function horizontalIntersects(
  minX: number,
  maxX: number,
  y: number,
  zoneMinX: number,
  zoneMaxX: number,
  zoneMinY: number,
  zoneMaxY: number,
): boolean {
  return y >= zoneMinY && y <= zoneMaxY && rangesOverlap(minX, maxX, zoneMinX, zoneMaxX);
}

function verticalIntersects(
  minY: number,
  maxY: number,
  x: number,
  zoneMinY: number,
  zoneMaxY: number,
  zoneMinX: number,
  zoneMaxX: number,
): boolean {
  return x >= zoneMinX && x <= zoneMaxX && rangesOverlap(minY, maxY, zoneMinY, zoneMaxY);
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax && bMin <= aMax;
}

// Human-readable message for the toast. Names the worst overhang so
// the operator knows which direction to shrink toward, and includes
// the actual numbers because "out of bounds" alone doesn't tell you
// whether to scale 5% or 50%.
export function describeFramePreflightFailure(
  p: Extract<FramePreflight, { kind: 'out-of-bounds' }>,
): string {
  const sides: string[] = [];
  if (p.overhang.minX > EPSILON_MM) sides.push(`left by ${p.overhang.minX.toFixed(1)} mm`);
  if (p.overhang.maxX > EPSILON_MM) sides.push(`right by ${p.overhang.maxX.toFixed(1)} mm`);
  if (p.overhang.minY > EPSILON_MM) sides.push(`front by ${p.overhang.minY.toFixed(1)} mm`);
  if (p.overhang.maxY > EPSILON_MM) sides.push(`back by ${p.overhang.maxY.toFixed(1)} mm`);
  const designSize = `${(p.bounds.maxX - p.bounds.minX).toFixed(0)}×${(p.bounds.maxY - p.bounds.minY).toFixed(0)} mm`;
  const bedSize = `${p.bed.width}×${p.bed.height} mm`;
  return `Cannot frame: design (${designSize}) overhangs the bed (${bedSize}) on ${sides.join(', ')}. Scale it down or move it onto the bed first.`;
}
