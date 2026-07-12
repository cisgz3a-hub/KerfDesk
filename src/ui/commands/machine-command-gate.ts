// machine-command-gate — decides which registry commands are visible for
// the active machine kind (ADR-101 gate-and-hide). Hidden commands are
// filtered out of buildAppCommands' result, so every command surface
// (menu bar, toolbar, workspace context menu) hides them uniformly.
//
// Classification checklist for NEW commands (ADR-101 consequence):
//   * effect exists only in the laser output pipeline → LASER_ONLY set
//   * effect exists only in the CNC output pipeline → CNC_ONLY set
//   * machine-agnostic (geometry, edit, view, file) → leave ungated

import type { MachineKind } from '../../core/scene';
import type { AppCommand, CommandId } from './command-types';

// Laser-only commands, per ADR-101 §2: calibration generators, Fill-mode
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
  'tools.print-and-cut',
  'tools.rotary-setup',
  'tools.optimization-settings',
  'tools.labs',
]);

// CNC-only commands (hidden in laser mode): the .nc program simulator —
// the laser pipeline has no Z-aware removal model to feed.
export const CNC_ONLY_COMMAND_IDS: ReadonlySet<CommandId> = new Set<CommandId>(['file.open-gcode']);

export function gateCommandsForMachineKind(
  commands: ReadonlyArray<AppCommand>,
  machineKind: MachineKind,
): ReadonlyArray<AppCommand> {
  const hidden = machineKind === 'cnc' ? LASER_ONLY_COMMAND_IDS : CNC_ONLY_COMMAND_IDS;
  return commands.filter((command) => !hidden.has(command.id));
}
