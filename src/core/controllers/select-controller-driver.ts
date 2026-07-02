// Resolve the ControllerDriver for a device profile's controller kind.
// Profiles without a kind (all pre-Phase-H .lf2 files) are GRBL — the only
// firmware that existed when they were written.

import type { ControllerKind } from '../devices/device-profile';
import type { ControllerDriver } from './controller-driver';
import { fluidncDriver } from './fluidnc/driver';
import { grblDriver } from './grbl/driver';
import { grblHalDriver } from './grblhal/driver';
import { marlinDriver } from './marlin/driver';
import { ruidaDriver } from './ruida/driver';
import { smoothiewareDriver } from './smoothieware/driver';

export function selectControllerDriver(kind: ControllerKind | undefined): ControllerDriver {
  switch (kind) {
    case 'grbl-v1.1':
    case undefined:
      return grblDriver;
    case 'grblhal':
      return grblHalDriver;
    case 'fluidnc':
      return fluidncDriver;
    case 'marlin':
      return marlinDriver;
    case 'smoothieware':
      return smoothiewareDriver;
    case 'ruida':
      return ruidaDriver;
  }
}
