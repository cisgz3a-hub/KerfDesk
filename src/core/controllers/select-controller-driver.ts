// Resolve the ControllerDriver for a device profile's controller kind.
// Profiles without a kind (all pre-Phase-H .lf2 files) are GRBL — the only
// firmware that existed when they were written.

import type { ControllerCommandSet, ControllerKind } from '../devices/device-profile';
import type { ControllerDriver } from './controller-driver';
import { fluidncDriver } from './fluidnc/driver';
import { grblDriver } from './grbl/driver';
import { grblHalDriver } from './grblhal/driver';
import { marlinDriver } from './marlin/driver';
import { moshiDriver } from './moshi/driver';
import { ruidaDriver } from './ruida/driver';
import { smoothiewareDriver } from './smoothieware/driver';
import { withFalconCommandContract } from './falcon-command-contract';

const falconGrblDriver = withFalconCommandContract(grblDriver);
const falconGrblHalDriver = withFalconCommandContract(grblHalDriver);

// One driver per kind; the Record type makes a new ControllerKind fail to
// compile until it has a driver here.
const DRIVERS: Readonly<Record<ControllerKind, ControllerDriver>> = {
  'grbl-v1.1': grblDriver,
  grblhal: grblHalDriver,
  fluidnc: fluidncDriver,
  marlin: marlinDriver,
  smoothieware: smoothiewareDriver,
  ruida: ruidaDriver,
  moshi: moshiDriver,
};

export function selectControllerDriver(
  kind: ControllerKind | undefined,
  commandSet?: ControllerCommandSet,
): ControllerDriver {
  if (commandSet === 'creality-falcon-a1-pro') {
    if (kind === 'grblhal') return falconGrblHalDriver;
    if (kind === undefined || kind === 'grbl-v1.1') return falconGrblDriver;
  }
  // An absent kind is GRBL (see above); so is one this build does not know.
  return (kind === undefined ? undefined : DRIVERS[kind]) ?? grblDriver;
}
