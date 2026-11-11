import type { DeviceProfile } from '../devices';
import { encodePower14 } from '../controllers/ruida/rd-numbers';
import { scaleS } from '../output/grbl-laser-lines';
import { powerScaleVersionForDevice } from '../output/laser-power-scale-version';
import { rasterCompilationPowerScale } from '../raster/controller-power-scale';
import type { Group } from './job';

/** Vector percentages can round to S0. Raster rows already contain their
 * compiled power values and are checked by the sweep planner instead. */
export function hasJobStartPower(group: Group, device?: DeviceProfile): boolean {
  if (group.kind === 'cnc') return true;
  if (!(group.power > 0)) return false;
  if (group.kind === 'raster') return true;
  return vectorPowerReachesController(group.power, device);
}

/** Whether a vector power percentage reaches the controller as more than S0;
 * true for any positive power when the machine is unknown. */
export function vectorPowerReachesController(power: number, device?: DeviceProfile): boolean {
  if (!(power > 0)) return false;
  if (device === undefined) return true;
  if (device.controllerKind === 'ruida') return encodePower14(power).some((byte) => byte !== 0);
  // A Moshiboard has no power value: any power above 0 fires at its dial (ADR-705).
  if (device.controllerKind === 'moshi') return true;
  // Smoothie and Marlin fan emission use their raster compilation ranges;
  // GRBL's canonical scaleS retains its own fractional-range rounding.
  const scale =
    device.controllerKind === 'smoothieware' || device.controllerKind === 'marlin'
      ? rasterCompilationPowerScale(device)
      : device.maxPowerS;
  const scaled = scaleS(power, scale, powerScaleVersionForDevice(device));
  return device.controllerKind === 'smoothieware'
    ? Number(((scaled / scale) * device.maxPowerS).toFixed(6)) > 0
    : scaled > 0;
}
