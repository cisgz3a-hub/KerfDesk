// Machine millimetres → galvo units (ADR-704). The bed is the lens field: the
// point goes back to the scene frame (top-left, +Y toward the operator) with
// the profile's own origin, scales so the field spans 0..0xFFFF, then takes
// MeerK40t's flips and swap in its order: flip X, flip Y, then swap
// (core/view.py L119-130 reset, L244-272 flips and swap, L274-293 transform;
// balormk/device.py L1133-1160 realize). With a centred origin the bed centre
// lands on 0x8000, where MeerK40t parks the beam (driver.py L315).

import type { DeviceProfile } from '../../devices';
import type { GalvoSetup } from '../../devices/galvo-setup';
import { toSceneCoords } from '../../devices/origin-transform';
import type { Vec2 } from '../../scene';
import { LMC_GALVO_MAX } from './lmc-opcodes';

export type GalvoPoint = { readonly gx: number; readonly gy: number };

export type GalvoFieldGeometry = Pick<DeviceProfile, 'origin' | 'bedWidth' | 'bedHeight'>;

/** Galvo units per millimetre across a square field. */
export function galvoUnitsPerMm(fieldMm: number): number {
  return LMC_GALVO_MAX / fieldMm;
}

/** The point in galvo units, or null when it lies outside the lens field. */
export function machineToGalvo(
  point: Vec2,
  device: GalvoFieldGeometry,
  setup: Pick<GalvoSetup, 'flipX' | 'flipY' | 'swapXY'>,
): GalvoPoint | null {
  const scene = toSceneCoords(point, device);
  let u = Math.round((scene.x * LMC_GALVO_MAX) / device.bedWidth);
  let v = Math.round((scene.y * LMC_GALVO_MAX) / device.bedHeight);
  if (setup.flipX) u = LMC_GALVO_MAX - u;
  if (setup.flipY) v = LMC_GALVO_MAX - v;
  const [gx, gy] = setup.swapXY ? [v, u] : [u, v];
  if (!inField(gx) || !inField(gy)) return null;
  return { gx, gy };
}

function inField(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= LMC_GALVO_MAX;
}
