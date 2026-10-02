import { cappedFirePowerS, type LaserFireControl } from '../../core/devices';
import type { LaserState } from './laser-store';

/** A saved S1000 profile must not overdrive a controller observed as S255.
 * Observations from an older controller session cannot qualify its scale.
 * This bounds commanded S, not measured optical output or vendor minimum PWM. */
export function currentFirePowerS(
  state: Pick<
    LaserState,
    'controllerSettings' | 'controllerSettingsObservation' | 'controllerSessionEpoch'
  >,
  control: LaserFireControl,
  profileMaxS: number,
  requestedPercent = control.maxPowerPercent,
): number {
  const observedMax =
    state.controllerSettingsObservation?.sessionEpoch === state.controllerSessionEpoch
      ? state.controllerSettings?.maxPowerS
      : undefined;
  const maxS =
    observedMax !== undefined && Number.isFinite(observedMax) && observedMax > 0
      ? Math.min(profileMaxS, observedMax)
      : profileMaxS;
  return Number.isFinite(maxS) && maxS > 0 ? cappedFirePowerS(requestedPercent, control, maxS) : 0;
}
