// grblHAL's homing passes (annoyance audit A2 B3-P2-2, ADR-322 Amendment 4).
//
// `$44` to `$49` ("Axes to home in first pass" to "sixth pass") are axis
// masks in the format of `$23`. `$H` runs each pass in turn and marks only
// that pass's axes homed (`sys.homed.mask |= cycle.mask`), so an axis named in
// no pass is never homed, and grblHAL keeps no work envelope for it
// (`limits_set_work_envelope` gives an unhomed axis 0..0):
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/settings.h
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c
// A `$$` dump lists them at COMPATIBILITY_LEVEL 0 or 1 (system.c). Stock GRBL
// and FluidNC have no such settings: their dumps give no mask.

const FIRST_HOMING_PASS_SETTING = 44;
const LAST_HOMING_PASS_SETTING = 49;

/** The axes a grblHAL Home covers: the union of the pass masks a `$$` dump
 *  listed, or nothing when it listed none or any of them is not a mask. */
export function homingCycleAxesField(map: ReadonlyMap<number, string>): {
  readonly homingCycleAxesMask?: number;
} {
  let mask = 0;
  let listed = false;
  for (let id = FIRST_HOMING_PASS_SETTING; id <= LAST_HOMING_PASS_SETTING; id += 1) {
    const raw = map.get(id);
    if (raw === undefined) continue;
    if (!/^\d+$/.test(raw.trim())) return {};
    mask |= Number(raw.trim());
    listed = true;
  }
  return listed ? { homingCycleAxesMask: mask } : {};
}
