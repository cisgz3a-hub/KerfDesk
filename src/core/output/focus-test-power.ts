import type { DeviceProfile } from '../devices';
import { formatGcodePowerS } from '../gcode/decimal-word';
import { scaleS } from './grbl-laser-lines';
import { powerScaleVersionForDevice } from './laser-power-scale-version';

/** A sample whose power is emitted as S0 burns nothing, so compilation drops it
 * with its Z move. Refuse such a power in the Focus Test dialog instead. */
export function focusTestPowerIssue(powerPercent: number, device: DeviceProfile): string | null {
  const version = powerScaleVersionForDevice(device);
  const s = scaleS(powerPercent, device.maxPowerS, version);
  return Number(formatGcodePowerS(s, version)) > 0
    ? null
    : `Power ${powerPercent}% is S0 on this machine's S range (S${device.maxPowerS} maximum), so no sample would burn. Raise the power.`;
}
