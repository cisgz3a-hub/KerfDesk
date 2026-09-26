import type { EditingToolsCommandId } from '../commands/editing-tools-command-types';
import type { CommandHelpTopic } from './command-help-topics';

// LightBurn gap batch 3 (ADR-410) commands.
export const EDITING_TOOLS_COMMAND_HELP: Readonly<Record<EditingToolsCommandId, CommandHelpTopic>> =
  {
    'edit.paste-in-place': {
      family: 'edit',
      tooltip:
        'Paste copied artwork at exactly the position it was copied from, even in another project.',
    },
    'edit.invert-selection': {
      family: 'edit',
      tooltip:
        'Select every unlocked, visible object that is not selected now, and deselect the rest.',
    },
    'edit.select-open-shapes': {
      family: 'edit',
      tooltip:
        'Select artwork on any operation that has a path whose ends do not meet, and report how many open paths it found.',
    },
    'tools.offset-shapes': {
      family: 'tools',
      tooltip:
        'Add an outline a set distance outward, inward or both ways around the selection, with round, bevelled or sharp corners and a live preview.',
    },
    'arrange.rotate-90-cw': {
      family: 'arrange',
      tooltip: 'Turn the selection a quarter turn clockwise about the centre of its bounds.',
    },
    'arrange.rotate-90-ccw': {
      family: 'arrange',
      tooltip:
        'Turn the selection a quarter turn counter-clockwise about the centre of its bounds.',
    },
    'arrange.move-to-bed-center': {
      family: 'arrange',
      tooltip: 'Move the selection so its centre sits on the centre of the bed.',
    },
    'arrange.move-to-bed-nw': {
      family: 'arrange',
      tooltip: 'Move the selection into the top-left corner of the bed.',
    },
    'arrange.move-to-bed-n': {
      family: 'arrange',
      tooltip: 'Move the selection against the top edge of the bed, centred left to right.',
    },
    'arrange.move-to-bed-ne': {
      family: 'arrange',
      tooltip: 'Move the selection into the top-right corner of the bed.',
    },
    'arrange.move-to-bed-w': {
      family: 'arrange',
      tooltip: 'Move the selection against the left edge of the bed, centred top to bottom.',
    },
    'arrange.move-to-bed-e': {
      family: 'arrange',
      tooltip: 'Move the selection against the right edge of the bed, centred top to bottom.',
    },
    'arrange.move-to-bed-sw': {
      family: 'arrange',
      tooltip: 'Move the selection into the bottom-left corner of the bed.',
    },
    'arrange.move-to-bed-s': {
      family: 'arrange',
      tooltip: 'Move the selection against the bottom edge of the bed, centred left to right.',
    },
    'arrange.move-to-bed-se': {
      family: 'arrange',
      tooltip: 'Move the selection into the bottom-right corner of the bed.',
    },
    'window.toggle-wireframe': {
      family: 'window',
      tooltip:
        'Draw Fill artwork as outlines instead of filled, to see overlaps and stray paths. Output is unchanged.',
    },
  };
