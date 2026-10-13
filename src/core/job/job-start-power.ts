import type { DeviceProfile } from '../devices';
import { scaleS } from '../output/grbl-laser-lines';
import { powerScaleVersionForDevice } from '../output/laser-power-scale-version';
import { rasterCompilationPowerScale } from '../raster/controller-power-scale';
import type { Group } from './job';

/** Vector percentages can round to S0. Raster rows already contain their
 * compiled power values and are checked by the sweep planner instead. */
export function hasJobStartPower(group: Group, device?: DeviceProfile): boolean {
  if (group.kind === 'cnc') return true;
  if (!(group.power > 0)) return false;
  if (group.kind === 'raster' || device === undefined) return true;
  // Smoothie and Marlin fan emission use their raster compilation ranges;
  // GRBL's canonical scaleS retains its own fractional-range rounding.
  const scale =
    device.controllerKind === 'smoothieware' || device.controllerKind === 'marlin'
      ? rasterCompilationPowerScale(device)
      : device.maxPowerS;
  const power = scaleS(group.power, scale, powerScaleVersionForDevice(device));
  return device.controllerKind === 'smoothieware'
    ? Number(((power / scale) * device.maxPowerS).toFixed(6)) > 0
    : power > 0;
}
