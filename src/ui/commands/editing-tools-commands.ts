// LightBurn gap batch 3 commands (ADR-410): Paste in Place, Invert Selection,
// Select Open Shapes, Offset Shapes, Rotate 90°, Move to bed and the Wireframe
// view. Shortcuts follow LightBurn where it documents one and KerfDesk has the
// key free; Move to bed centre has none because P is KerfDesk's Preview.

import type { SelectionAnchor } from '../../core/scene';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import type { EditingToolsCommandId } from './editing-tools-command-types';

export const PASTE_IN_PLACE_SHORTCUT = 'Ctrl+Shift+V';
export const INVERT_SELECTION_SHORTCUT = 'Ctrl+Shift+I';
export const ROTATE_CW_SHORTCUT = '.';
export const ROTATE_CCW_SHORTCUT = ',';
export const WIREFRAME_SHORTCUT = 'Alt+W';

const NEEDS_SELECTION = 'Select an object to rotate or move.';

export function selectionEditCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled(
      'edit.invert-selection',
      'edit',
      'Invert Selection',
      'Select the unselected artwork and deselect the rest',
      ctx.invertSelection,
      INVERT_SELECTION_SHORTCUT,
    ),
    enabled(
      'edit.select-open-shapes',
      'edit',
      'Select Open Shapes',
      'Select artwork with a path whose ends do not meet',
      ctx.selectOpenShapes,
    ),
  ];
}

export function pasteInPlaceCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canPaste
    ? enabled(
        'edit.paste-in-place',
        'edit',
        'Paste in Place',
        'Paste copied artwork at the position it was copied from',
        ctx.pasteInPlace,
        PASTE_IN_PLACE_SHORTCUT,
      )
    : disabled(
        'edit.paste-in-place',
        'edit',
        'Paste in Place',
        'Copy or cut artwork first.',
        ctx.pasteInPlace,
        PASTE_IN_PLACE_SHORTCUT,
      );
}

export function offsetShapesCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canOffsetShapes
    ? enabled(
        'tools.offset-shapes',
        'tools',
        'Offset Shapes...',
        'Add an outline outward, inward or both ways around the selected shapes',
        ctx.offsetShapes,
      )
    : disabled(
        'tools.offset-shapes',
        'tools',
        'Offset Shapes...',
        'Select unlocked vector artwork first.',
        ctx.offsetShapes,
      );
}

type PlacementSpec = {
  readonly id: EditingToolsCommandId;
  readonly label: string;
  readonly title: string;
  readonly run: (ctx: AppCommandContext) => void;
  readonly shortcut?: string;
};

const ROTATE_SPECS: ReadonlyArray<PlacementSpec> = [
  {
    id: 'arrange.rotate-90-cw',
    label: 'Rotate 90° Clockwise',
    title: 'Turn the selection a quarter turn clockwise about its centre',
    run: (ctx) => ctx.rotateSelectionQuarterTurn(1),
    shortcut: ROTATE_CW_SHORTCUT,
  },
  {
    id: 'arrange.rotate-90-ccw',
    label: 'Rotate 90° Counter-clockwise',
    title: 'Turn the selection a quarter turn counter-clockwise about its centre',
    run: (ctx) => ctx.rotateSelectionQuarterTurn(-1),
    shortcut: ROTATE_CCW_SHORTCUT,
  },
];

const BED_ANCHORS: ReadonlyArray<{
  readonly id: EditingToolsCommandId;
  readonly anchor: SelectionAnchor;
  readonly label: string;
  readonly where: string;
}> = [
  {
    id: 'arrange.move-to-bed-center',
    anchor: 'c',
    label: 'Bed Center',
    where: 'to the bed centre',
  },
  {
    id: 'arrange.move-to-bed-nw',
    anchor: 'nw',
    label: 'Top Left',
    where: 'into the top-left corner',
  },
  { id: 'arrange.move-to-bed-n', anchor: 'n', label: 'Top', where: 'to the top edge, centred' },
  {
    id: 'arrange.move-to-bed-ne',
    anchor: 'ne',
    label: 'Top Right',
    where: 'into the top-right corner',
  },
  { id: 'arrange.move-to-bed-w', anchor: 'w', label: 'Left', where: 'to the left edge, centred' },
  { id: 'arrange.move-to-bed-e', anchor: 'e', label: 'Right', where: 'to the right edge, centred' },
  {
    id: 'arrange.move-to-bed-sw',
    anchor: 'sw',
    label: 'Bottom Left',
    where: 'into the bottom-left corner',
  },
  {
    id: 'arrange.move-to-bed-s',
    anchor: 's',
    label: 'Bottom',
    where: 'to the bottom edge, centred',
  },
  {
    id: 'arrange.move-to-bed-se',
    anchor: 'se',
    label: 'Bottom Right',
    where: 'into the bottom-right corner',
  },
];

const MOVE_SPECS: ReadonlyArray<PlacementSpec> = BED_ANCHORS.map((entry) => ({
  id: entry.id,
  label: `Move to ${entry.label}`,
  title: `Move the selection ${entry.where} of the bed`,
  run: (ctx) => ctx.moveSelectionToBed(entry.anchor),
}));

export function placementCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [...ROTATE_SPECS, ...MOVE_SPECS].map((spec) =>
    ctx.canTransformSelection
      ? enabled(spec.id, 'arrange', spec.label, spec.title, () => spec.run(ctx), spec.shortcut)
      : disabled(
          spec.id,
          'arrange',
          spec.label,
          NEEDS_SELECTION,
          () => spec.run(ctx),
          spec.shortcut,
        ),
  );
}

export function wireframeCommand(ctx: AppCommandContext): AppCommand {
  return {
    ...enabled(
      'window.toggle-wireframe',
      'window',
      'Wireframe View',
      ctx.wireframeActive
        ? 'Draw Fill artwork filled again'
        : 'Draw Fill artwork as outlines so overlaps and stray paths show',
      ctx.toggleWireframe,
      WIREFRAME_SHORTCUT,
    ),
    active: ctx.wireframeActive,
  };
}
