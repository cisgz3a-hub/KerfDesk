// FluidNC's S range (controller audit v4 E1-P2-1, ADR-567 Amendment 2).
// FluidNC parses S as a float but keeps it as a whole SpindleSpeed
// (`typedef uint32_t SpindleSpeed`, SpindleDatatypes.h) before its speed_map,
// so S0.6 runs as S0. Its `$30` is the top of the spindle's speed_map. KerfDesk
// therefore sends FluidNC whole S words, and a top below 100 cannot give each
// whole percentage its own S: powers round to the nearest step, and the
// lowest round to S0.
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SpindleDatatypes.h
// https://github.com/bdring/FluidNC/blob/main/FluidNC/src/GCode.cpp

import { MIN_WHOLE_NUMBER_POWER_STEPS } from '../output/laser-power-scale-version';
import type { DeviceProfile } from './device-profile';

/** The S range a FluidNC job is written for, and where it came from. */
export type FluidncPowerRange = {
  readonly maxPowerS: number;
  readonly source: 'controller' | 'profile';
};

/** Job Review text when a FluidNC job's full-power S leaves fewer than 100
 *  whole steps, or null. A warning only, never a Start guard (ADR-565). */
export function fluidncPowerStepWarning(
  device: Pick<DeviceProfile, 'controllerKind'>,
  range: FluidncPowerRange,
): string | null {
  if (device.controllerKind !== 'fluidnc') return null;
  const top = range.maxPowerS;
  if (!(top > 0) || top >= MIN_WHOLE_NUMBER_POWER_STEPS) return null;
  const where =
    range.source === 'controller'
      ? `the connected controller's $30=${top}, the top of its speed_map`
      : `this profile's Full-power S${top}`;
  const half = percentText(50 / top);
  const steps =
    top <= 1
      ? `Every power below ${half} sends S0 and burns nothing, and every power from ${half} burns at full power.`
      : `Power moves in ${percentText(100 / top)} steps: each power is sent as the nearest whole S, up to ${half} from the set value, and every power below ${half} sends S0 and burns nothing.`;
  return (
    `FluidNC keeps every S word as a whole number, and full power here is ${where}. ${steps} ` +
    "Set the top of the spindle's speed_map in the FluidNC config to 100 or more (FluidNC's " +
    'Laser default is 255) before burning, so each whole percentage gets its own S.'
  );
}

function percentText(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}
