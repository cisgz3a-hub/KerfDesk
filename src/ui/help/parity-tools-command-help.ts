import type { ParityToolsCommandId } from '../commands/parity-tools-command-types';
import type { CommandHelpTopic } from './command-help-topics';

export const PARITY_TOOLS_COMMAND_HELP: Readonly<Record<ParityToolsCommandId, CommandHelpTopic>> = {
  'tools.save-original-image': {
    family: 'tools',
    tooltip:
      'Save the selected image as PNG, JPEG or BMP exactly as it is in the project, before any operation dithers, adjusts or masks it. Save Processed Bitmap saves what the laser engraves instead.',
  },
  'window.save-preview-image': {
    family: 'window',
    tooltip:
      'Save the workspace as shown in Preview, with the toolpath and the playback position, as a PNG at screen resolution. Zoom or pan first to frame it. The job itself is not changed.',
  },
  'tools.generate-path-from-cut': {
    family: 'tools',
    tooltip:
      'Compile the selected artwork, or all of it, exactly as output would and add what the laser burns as new artwork: kerf offsets, tabs, perforation dashes, overcuts and fill lines. The new object is bound to no operation, so it never burns again until you assign it; image engraving is pixels and is left out.',
  },
};
