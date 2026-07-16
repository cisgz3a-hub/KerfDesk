import type { JobStartMode } from '../../core/job';
import type { MachineKind } from '../../core/scene';
import type { HomingState } from '../state/laser-store';

export const ABSOLUTE_HOME_REQUIRED_MESSAGE =
  'Absolute Coordinates needs a trusted machine position. Home this machine in the current connection before framing or starting; Start will not home it automatically.';

export function absoluteCoordinatesHomeIssue(input: {
  readonly machineKind: MachineKind;
  readonly startFrom: JobStartMode;
  readonly homingEnabled: boolean;
  readonly homingState: HomingState;
}): string | null {
  if (input.machineKind !== 'laser') return null;
  if (input.startFrom !== 'absolute' || !input.homingEnabled) return null;
  return input.homingState === 'confirmed' ? null : ABSOLUTE_HOME_REQUIRED_MESSAGE;
}
