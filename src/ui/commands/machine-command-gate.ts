// machine-command-gate — decides which registry commands are visible for
// the active machine kind (ADR-100 gate-and-hide). Hidden commands are
// filtered out of buildAppCommands' result, so every command surface
// (menu bar, toolbar, workspace context menu) hides them uniformly.
//
// Classification checklist for NEW commands (ADR-100 consequence):
//   * effect exists only in the laser output pipeline → add its id here
//   * effect exists only in the CNC output pipeline → gate the other way
//     (introduce a CNC_ONLY set when the first such command lands)
//   * machine-agnostic (geometry, edit, view, file) → leave ungated

import type { MachineKind } from '../../core/scene';
import type { AppCommand, CommandId } from './command-types';

// Laser-only commands, per ADR-100 §2: calibration generators, Fill-mode
// tools, raster/Image-mode processing (CNC compile never consumes rasters),
// the Trace family, the Registration Jig, and laser path optimization
// (optimizePaths passes kind:'cnc' groups through untouched).
export const LASER_ONLY_COMMAND_IDS: ReadonlySet<CommandId> = new Set<CommandId>([
  'tools.material-test',
  'tools.interval-test',
  'tools.scan-offset-test',
  'tools.focus-test',
  'tools.fill-selection',
  'tools.close-open-fill-contours',
  'tools.close-fill-contours-with-tolerance',
  'tools.convert-to-bitmap',
  'tools.trace-image',
  'tools.retrace-original',
  'tools.multi-file-trace',
  'tools.adjust-image',
  'tools.apply-image-mask',
  'tools.crop-image',
  'tools.remove-image-mask',
  'tools.save-processed-bitmap',
  'tools.registration-jig',
  'tools.optimization-settings',
]);

export function gateCommandsForMachineKind(
  commands: ReadonlyArray<AppCommand>,
  machineKind: MachineKind,
): ReadonlyArray<AppCommand> {
  if (machineKind !== 'cnc') return commands;
  return commands.filter((command) => !LASER_ONLY_COMMAND_IDS.has(command.id));
}
