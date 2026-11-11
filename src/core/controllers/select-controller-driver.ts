// Resolve the ControllerDriver for a device profile's controller kind.
// Profiles without a kind (all pre-Phase-H .lf2 files) are GRBL — the only
// firmware that existed when they were written.

import type { ControllerCommandSet, ControllerKind } from '../devices/device-profile';
import type { ControllerDriver } from './controller-driver';
import { fluidncDriver } from './fluidnc/driver';
import { grblDriver } from './grbl/driver';
import { grblHalDriver } from './grblhal/driver';
import { jczLmcDriver } from './jcz/driver';
import { marlinDriver } from './marlin/driver';
import { ruidaDriver } from './ruida/driver';
import { smoothiewareDriver } from './smoothieware/driver';
import { withFalconCommandContract } from './falcon-command-contract';

const falconGrblDriver = withFalconCommandContract(grblDriver);
const falconGrblHalDriver = withFalconCommandContract(grblHalDriver);

export function selectControllerDriver(
  kind: ControllerKind | undefined,
  commandSet?: ControllerCommandSet,
): ControllerDriver {
  if (commandSet === 'creality-falcon-a1-pro') {
    if (kind === 'grblhal') return falconGrblHalDriver;
    if (kind === undefined || kind === 'grbl-v1.1') return falconGrblDriver;
  }
  return kind === undefined ? grblDriver : DRIVERS[kind];
}

const DRIVERS: Readonly<Record<ControllerKind, ControllerDriver>> = {
  'grbl-v1.1': grblDriver,
  grblhal: grblHalDriver,
  fluidnc: fluidncDriver,
  marlin: marlinDriver,
  smoothieware: smoothiewareDriver,
  ruida: ruidaDriver,
  'jcz-lmc': jczLmcDriver,
};
