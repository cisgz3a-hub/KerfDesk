// Resolve the output strategy for a device (ADR-094/095). The GRBL family
// (grbl-v1.1, grblHAL, FluidNC, and profiles without a kind) shares one
// G-code emitter; Marlin gets its dialect-aware wrapper.

import type { DeviceProfile } from '../devices';
import { grblStrategy } from './grbl-strategy';
import { marlinStrategy } from './marlin-strategy';

export type AnyOutputStrategy = typeof grblStrategy | typeof marlinStrategy;

export function selectOutputStrategy(device: DeviceProfile): AnyOutputStrategy {
  const kind = device.controllerKind;
  switch (kind) {
    case 'marlin':
      return marlinStrategy;
    case 'grbl-v1.1':
    case 'grblhal':
    case 'fluidnc':
    case undefined:
      return grblStrategy;
    default:
      return assertNeverControllerKind(kind);
  }
}

function assertNeverControllerKind(kind: never): never {
  throw new Error(`Unhandled controller kind: ${String(kind)}`);
}
