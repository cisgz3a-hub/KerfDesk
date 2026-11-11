// Resolve the output strategy for a device (ADR-094/095). The GRBL family
// (grbl-v1.1, grblHAL, FluidNC, and profiles without a kind) shares one
// G-code emitter; Marlin gets its dialect-aware wrapper.

import type { DeviceProfile } from '../devices';
import { grblStrategy } from './grbl-strategy';
import { marlinStrategy } from './marlin-strategy';
import { smoothiewareStrategy } from './smoothieware-strategy';

export type AnyOutputStrategy =
  | typeof grblStrategy
  | typeof marlinStrategy
  | typeof smoothiewareStrategy;

export function selectOutputStrategy(device: DeviceProfile): AnyOutputStrategy {
  const kind = device.controllerKind;
  switch (kind) {
    case 'marlin':
      return marlinStrategy;
    case 'smoothieware':
      return smoothiewareStrategy;
    case 'grbl-v1.1':
    case 'grblhal':
    case 'fluidnc':
    case undefined:
      return grblStrategy;
    // Ruida and Lihuiyu output is NOT G-code — Save routes to the binary .rd
    // encoder (io/rd) or the .egv writer (io/egv, ADR-703) before any strategy
    // runs; a Moshiboard has no file at all and its USB link encodes programs
    // (io/moshi, ADR-705). The GRBL emitter here only feeds the on-screen
    // preview/estimate pipeline fallback.
    case 'ruida':
    case 'lihuiyu':
    case 'moshi':
      return grblStrategy;
    default:
      return assertNeverControllerKind(kind);
  }
}

function assertNeverControllerKind(kind: never): never {
  throw new Error(`Unhandled controller kind: ${String(kind)}`);
}
