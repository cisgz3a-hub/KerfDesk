// Resolve the ControllerDriver for a device profile's controller kind.
// Profiles without a kind (all pre-Phase-H .lf2 files) are GRBL — the only
// firmware that existed when they were written.

import type { ControllerKind } from '../devices/device-profile';
import type { ControllerDriver } from './controller-driver';
import { grblDriver } from './grbl/driver';

export function selectControllerDriver(kind: ControllerKind | undefined): ControllerDriver {
  switch (kind) {
    case 'grbl-v1.1':
    case undefined:
      return grblDriver;
  }
}
