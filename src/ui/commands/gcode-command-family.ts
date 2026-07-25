// The two G-code read-side commands (ADR-255): inspect the current canvas
// program in 3D, and open a program file in the same Inspector. Both are
// available in laser and CNC modes (ADR-255 lifted the ADR-101 gate).

import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function gcodeInspectorCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled(
      'file.inspect-gcode',
      'file',
      'Inspect G-code (3D)...',
      "Inspect this project's G-code in 3D",
      ctx.inspectCurrentGcode,
    ),
    enabled(
      'file.open-gcode',
      'file',
      'Open G-code...',
      'Inspect a G-code file in 3D',
      ctx.openGcodePreview,
    ),
  ];
}
