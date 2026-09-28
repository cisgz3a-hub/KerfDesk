// LightBurn gap batch 5 commands (ADR-480): Select Contained, Select Smaller
// Shapes, Delete Duplicates (Alt+D, as in LightBurn), Close Path, Reverse
// Direction, Create Rubber-Band Outline and Flatten Image Mask.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import { optimizeShapesCommand } from './optimize-shapes-commands';
import { warpDeformCommands } from './warp-deform-commands';

export const DELETE_DUPLICATES_SHORTCUT = 'Alt+D';

const NEEDS_PATHS = 'Select unlocked imported, traced or drawn-line artwork first.';

export function designSelectionCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ctx.hasSelection
      ? enabled(
          'edit.select-contained',
          'edit',
          'Select Contained',
          'Add the artwork lying inside the selected closed shape',
          ctx.selectContainedShapes,
        )
      : disabled(
          'edit.select-contained',
          'edit',
          'Select Contained',
          'Select a closed shape first.',
          ctx.selectContainedShapes,
        ),
    ctx.hasSelection
      ? enabled(
          'edit.select-smaller',
          'edit',
          'Select Smaller Shapes',
          'Add the artwork no wider and no taller than the selection',
          ctx.selectSmallerShapes,
        )
      : disabled(
          'edit.select-smaller',
          'edit',
          'Select Smaller Shapes',
          'Select a shape to compare with first.',
          ctx.selectSmallerShapes,
        ),
  ];
}

export function deleteDuplicatesCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'edit.delete-duplicates',
    'edit',
    'Delete Duplicates',
    'Delete artwork drawn twice in the same place on the same operation',
    ctx.deleteDuplicates,
    DELETE_DUPLICATES_SHORTCUT,
  );
}

export function designToolsCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ctx.hasSelection
      ? enabled(
          'tools.rubber-band-outline',
          'tools',
          'Rubber-Band Outline',
          'Add one closed outline stretched around the selection',
          ctx.addRubberBandOutline,
        )
      : disabled(
          'tools.rubber-band-outline',
          'tools',
          'Rubber-Band Outline',
          'Select the artwork to outline first.',
          ctx.addRubberBandOutline,
        ),
    pathCommand(
      ctx,
      'tools.close-paths',
      'Close Path',
      'Close the open paths of the selection',
      ctx.closeSelectedPaths,
    ),
    pathCommand(
      ctx,
      'tools.reverse-paths',
      'Reverse Direction',
      'Reverse the direction the selected paths are cut in',
      ctx.reverseSelectedPaths,
    ),
    ...warpDeformCommands(ctx),
    optimizeShapesCommand(ctx),
    ctx.hasMaskedRasterSelection
      ? enabled(
          'tools.flatten-image-mask',
          'tools',
          'Flatten Image Mask',
          'Bake the mask into the image, crop it, and delete the mask shape',
          ctx.flattenImageMask,
        )
      : disabled(
          'tools.flatten-image-mask',
          'tools',
          'Flatten Image Mask',
          'Select an image that already has a mask.',
          ctx.flattenImageMask,
        ),
  ];
}

// LBG-T09, in the Arrange menu beside Array. Any selection may try it: a
// selection without artwork and a guide path gets a notice saying what to add.
export function copyAlongPathCommand(ctx: AppCommandContext): AppCommand {
  return ctx.hasSelection
    ? enabled(
        'arrange.copy-along-path',
        'arrange',
        'Copy Along Path...',
        'Copy the selected artwork along a selected guide path',
        ctx.copyAlongPath,
      )
    : disabled(
        'arrange.copy-along-path',
        'arrange',
        'Copy Along Path...',
        'Select the artwork and a guide path first.',
        ctx.copyAlongPath,
      );
}

function pathCommand(
  ctx: AppCommandContext,
  id: 'tools.close-paths' | 'tools.reverse-paths',
  label: string,
  title: string,
  invoke: () => void,
): AppCommand {
  return ctx.canEditSelectedPaths
    ? enabled(id, 'tools', label, title, invoke)
    : disabled(id, 'tools', label, NEEDS_PATHS, invoke);
}
