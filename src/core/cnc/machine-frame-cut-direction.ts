// Climb vs conventional is defined against the spindle's PHYSICAL rotation seen
// from above the bed (M3 = clockwise), but `enforceCutDirection` resolves a
// toolpath's winding from a shoelace sign over MACHINE coordinates. Those two
// agree only while the machine frame is right-handed in the top view, and
// `origin-transform` does not make it so for every origin corner: rear-* origins
// leave machine +Y pointing AT the operator and right-* origins mirror +X, so
// `front-right` and `rear-left` yield left-handed frames. There, asking for
// climb emitted conventional and — the dangerous direction — asking for
// conventional on a backlash-prone machine emitted climb.
//
// Translating the operator's physical intent into the machine frame once, here,
// keeps every geometry stage below working purely in machine coordinates.

import { toMachineCoords, type DeviceProfile } from '../devices';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { CncCutDirection, CncLayerSettings, Vec2 } from '../scene';

// A unit right triangle with a POSITIVE shoelace area in the scene frame. The
// scene frame is Y-down over a canvas that is a top view of the bed, so that
// positive area is physically CLOCKWISE from above; mapping the triangle through
// the device origin reveals whether machine coordinates preserve that sign.
const ORIENTATION_PROBE: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

/**
 * The cut direction to hand the machine-frame geometry stages so the emitted
 * motion matches `direction` as the operator sees it from in front of the bed.
 */
export function machineFrameCutDirection(
  direction: CncCutDirection,
  device: DeviceProfile,
): CncCutDirection {
  if (machineFrameMatchesTopView(device)) return direction;
  return direction === 'climb' ? 'conventional' : 'climb';
}

/**
 * Layer settings with {@link machineFrameCutDirection} applied. An absent
 * direction stays absent — that is the "Default direction" option, which asks
 * for the compiler's natural winding and never enforces one.
 */
export function withMachineFrameCutDirection(
  settings: CncLayerSettings,
  device: DeviceProfile,
): CncLayerSettings {
  const { cutDirection } = settings;
  if (cutDirection === undefined) return settings;
  const translated = machineFrameCutDirection(cutDirection, device);
  // Same object on the no-op path: downstream stages key tab mappings off
  // toolpath identity, so needless clones are worth avoiding.
  return translated === cutDirection ? settings : { ...settings, cutDirection: translated };
}

/**
 * True when a shoelace-positive loop in this device's machine coordinates is
 * also counter-clockwise as seen from above the bed.
 */
export function machineFrameMatchesTopView(device: DeviceProfile): boolean {
  return signedAreaMm2(ORIENTATION_PROBE.map((point) => toMachineCoords(point, device))) < 0;
}
