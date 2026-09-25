// laser-tool-off-air — the Manual Air latch follows the air-off a motion
// prefix sends (controller audit CG-5).
//
// The GRBL and Smoothieware tool-off prefixes end with M9, which switches the
// coolant/air output off before the motion. Smoothieware reports no accessory
// field to re-sync the latch from (Kernel.cpp L177-L300, unlike GRBL's `A:`),
// so the rail kept showing Manual Air ON with the pump off, and the next click
// sent M9 again. Clearing the latch once the transport accepts that M9 keeps
// every jog, Frame and Home starting from a known accessory-off state and the
// rail truthful. A failed write leaves the latch alone: M9 may not have
// arrived, and the operator keeps the Air OFF control.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L177-L300

import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';

const TOOL_OFF_ACTIONS: ReadonlySet<LaserSafetyAction> = new Set(['jog', 'frame', 'home']);

export function toolOffAirPatch(
  line: string,
  action: LaserSafetyAction | undefined,
): Partial<Pick<LaserState, 'airAssistOn'>> {
  if (action === undefined || !TOOL_OFF_ACTIONS.has(action)) return {};
  const sendsAirOff = line.split('\n').some((part) => part.trim().toUpperCase() === 'M9');
  return sendsAirOff ? { airAssistOn: false } : {};
}
