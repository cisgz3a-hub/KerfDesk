import type { CommandId } from '../commands/command-types';
import type { CommandHelpTopic } from './command-help-topics';

type RasterCommandId = Extract<
  CommandId,
  | 'tools.adjust-image'
  | 'tools.photo-engraving'
  | 'tools.edit-image'
  | 'tools.apply-image-mask'
  | 'tools.crop-image'
  | 'tools.remove-image-mask'
  | 'tools.save-processed-bitmap'
  | 'tools.trace-image'
  | 'tools.retrace-original'
  | 'tools.multi-file-trace'
>;

export const RASTER_COMMAND_HELP: Readonly<Record<RasterCommandId, CommandHelpTopic>> = {
  'tools.adjust-image': {
    family: 'tools',
    tooltip: 'Tune brightness, contrast, gamma, and dithering for the selected image.',
  },
  'tools.photo-engraving': {
    family: 'tools',
    tooltip: 'Prepare portraits and photo shading with laser dots.',
  },
  'tools.edit-image': {
    family: 'tools',
    tooltip: 'Open the Image Studio to paint, erase, and edit selected areas of the image.',
  },
  'tools.apply-image-mask': {
    family: 'tools',
    tooltip:
      'Use selected closed vector geometry as a non-destructive mask for the selected image.',
  },
  'tools.crop-image': {
    family: 'tools',
    tooltip: 'Bake the selected image mask into pixels and crop the image bounds.',
  },
  'tools.remove-image-mask': {
    family: 'tools',
    tooltip: 'Remove the selected image mask without changing the original image pixels.',
  },
  'tools.save-processed-bitmap': {
    family: 'tools',
    tooltip: 'Save the selected image as the processed bitmap KerfDesk will engrave.',
  },
  'tools.trace-image': {
    family: 'tools',
    tooltip: 'Trace the selected bitmap into editable vector paths.',
  },
  'tools.retrace-original': {
    family: 'tools',
    tooltip: 'Re-open Trace Image from the original raster kept behind the selected trace.',
  },
  'tools.multi-file-trace': {
    family: 'tools',
    tooltip:
      'Trace multiple image files with one preset to standalone SVG, DXF, PDF, EPS or GeoJSON files without changing the workspace. The page is the image size or fits the artwork with a margin. Images with nothing to trace are skipped and listed.',
  },
};
