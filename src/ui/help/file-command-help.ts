import type { CommandId } from '../commands/command-types';
import type { CommandHelpTopic } from './command-help-topics';

export const FILE_COMMAND_HELP: Readonly<
  Record<Extract<CommandId, `file.${string}`>, CommandHelpTopic>
> = {
  'file.new': {
    family: 'file',
    tooltip: 'Create a new blank project.',
  },
  'file.open': {
    family: 'file',
    tooltip: 'Open a saved KerfDesk project file.',
  },
  'file.open-recent': {
    family: 'file',
    tooltip:
      'Reopen a project you recently opened or saved on this computer, and pin, remove or clear entries.',
  },
  'file.save': {
    family: 'file',
    tooltip: 'Save the current project to its existing file.',
  },
  'file.save-as': {
    family: 'file',
    tooltip: 'Save the current project as a new file.',
  },
  'file.open-template': {
    family: 'file',
    tooltip: 'Start a new unsaved project from a template. The first Save asks for a destination.',
  },
  'file.save-template': {
    family: 'file',
    tooltip:
      'Save artwork, notes, unused operations and settings as a reusable protected template.',
  },
  'file.import': {
    family: 'file',
    tooltip: 'Import SVG, DXF, PDF/compatible AI, HPGL/PLT, images or STL artwork.',
  },
  'file.import-svg': {
    family: 'file',
    tooltip: 'Import vector artwork from an SVG file.',
  },
  'file.import-dxf': {
    family: 'file',
    tooltip: 'Import vector artwork from an ASCII DXF drawing (works in laser and CNC mode).',
  },
  'file.import-image': {
    family: 'file',
    tooltip:
      'Import PNG, JPG, BMP, GIF or TIFF for engraving or tracing. GIF uses its first frame.',
  },
  'file.import-height-map': {
    family: 'file',
    tooltip:
      'Import a qualified non-interlaced grayscale PNG (8-bit, 16-bit, or 8-bit with alpha) as an explicit top-down CNC relief height map.',
  },
  'file.open-gcode': {
    family: 'file',
    tooltip: 'Open a .nc/.gcode/.tap program in the 3D Inspector (both machine modes).',
  },
  'file.inspect-gcode': {
    family: 'file',
    tooltip: "Compile this project's G-code and inspect it in 3D — read-only, nothing is saved.",
  },
  'file.save-gcode': {
    family: 'file',
    tooltip: 'Export the current job as GRBL G-code.',
  },
  'file.export-svg': {
    family: 'file',
    tooltip:
      'Export selected artwork as SVG, or all artwork when nothing is selected. Text is outlined and images are embedded; production serials do not advance.',
  },
};
