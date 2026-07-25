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
// the Registration Jig, and laser path optimization (optimizePaths passes
// kind:'cnc' groups through untouched). The Trace family was reclassified
// machine-agnostic by the 2026-07-13 ADR-101 amendment (traced vectors flow
// into the CNC cut pipeline), so it is deliberately NOT in this set.
//
// Raster commands split on bake-vs-engrave-stage, because CNC can trace a
// bitmap even though it can never engrave one. A command that BAKES pixels
// changes what traceImage() reads out of RasterImage.dataUrl, so it is
// machine-agnostic; one that only carries engrave-stage scalars is laser-only.
// Crop and the mask pair bake (cropMaskedRasterImage commits a replacement
// RasterImage), so they are not in this set. Adjust Image stays laser-only:
// its brightness/contrast/gamma are live engrave-stage scalars that never
// touch dataUrl. Convert to Bitmap (vectors -> raster) and Save Processed
// Bitmap (export after laser layer processing) stay laser-only too.
export const LASER_ONLY_COMMAND_IDS: ReadonlySet<CommandId> = new Set<CommandId>([
  'tools.material-test',
  'tools.interval-test',
  'tools.scan-offset-test',
  'tools.focus-test',
  'tools.fill-selection',
  'tools.close-open-fill-contours',
  'tools.close-fill-contours-with-tolerance',
  'tools.convert-to-bitmap',
  'tools.adjust-image',
  'tools.save-processed-bitmap',
  'tools.registration-jig',
  'tools.print-and-cut',
  'tools.rotary-setup',
  'tools.optimization-settings',
  'tools.labs',
]);

// CNC-only commands (hidden in laser mode): the .nc program simulator —
// the laser pipeline has no Z-aware removal model to feed.
// ADR-255 lifted the last CNC-only command: file.open-gcode now opens the
// G-code Inspector in both machine modes. The gate machinery stays for
// future commands.
export const CNC_ONLY_COMMAND_IDS: ReadonlySet<CommandId> = new Set<CommandId>();

export function gateCommandsForMachineKind(
  commands: ReadonlyArray<AppCommand>,
  machineKind: MachineKind,
): ReadonlyArray<AppCommand> {
  const hidden = machineKind === 'cnc' ? LASER_ONLY_COMMAND_IDS : CNC_ONLY_COMMAND_IDS;
  return commands.filter((command) => !hidden.has(command.id));
}
