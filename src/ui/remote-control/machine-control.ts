import { MachineControlRegistry } from './machine-control-registry';
import type { RemoteControlOptions } from './types';

export function createMachineControl(options: RemoteControlOptions, revision: () => string) {
  return new MachineControlRegistry(options, revision);
}
