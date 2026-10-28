// LightBurn parity layout commands in the Arrange menu: Change Draw Order,
// Make Same Width / Height and Move H / V Together. Their keys, LightBurn's,
// are in arrange-shortcut-keys.ts.

import type { DrawOrderMove } from '../../core/draw-order';
import type { SelectionMoveTogetherAxis } from '../../core/scene/selection-move-together';
import { arrangeShortcutLabel } from './arrange-shortcut-keys';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import type { LayoutCommandId } from './layout-command-types';

export const DRAW_ORDER_IDS: ReadonlyArray<LayoutCommandId> = [
  'arrange.bring-to-front',
  'arrange.bring-forward',
  'arrange.send-backward',
  'arrange.send-to-back',
];

export const MATCH_SIZE_IDS: ReadonlyArray<LayoutCommandId> = [
  'arrange.same-width',
  'arrange.same-height',
  'arrange.same-width-proportional',
  'arrange.same-height-proportional',
];

export const MOVE_TOGETHER_IDS: ReadonlyArray<LayoutCommandId> = [
  'arrange.move-together-horizontal',
  'arrange.move-together-vertical',
];

export const FREE_TRANSFORM_IDS: ReadonlyArray<LayoutCommandId> = [
  'arrange.mirror-across-line',
  'arrange.two-point-rotate-scale',
];

type Spec = {
  readonly id: LayoutCommandId;
  readonly label: string;
  readonly title: string;
  readonly invoke: (ctx: AppCommandContext) => void;
  readonly family?: 'arrange' | 'tools' | 'window';
};

type Step<Value> = {
  readonly id: LayoutCommandId;
  readonly value: Value;
  readonly label: string;
  readonly title: string;
};

// Read by the menu and by the draw-order and Move Together keys
// (app/arrange-shortcuts.ts), which name their undo steps after these labels.
export const DRAW_ORDER_STEPS: ReadonlyArray<Step<DrawOrderMove>> = [
  {
    id: 'arrange.bring-to-front',
    value: 'front',
    label: 'Bring to Front',
    title: 'Draw the selection on top of all other artwork',
  },
  {
    id: 'arrange.bring-forward',
    value: 'forward',
    label: 'Bring Forward',
    title: 'Draw the selection one step higher',
  },
  {
    id: 'arrange.send-backward',
    value: 'backward',
    label: 'Send Backward',
    title: 'Draw the selection one step lower',
  },
  {
    id: 'arrange.send-to-back',
    value: 'back',
    label: 'Send to Back',
    title: 'Draw the selection behind all other artwork',
  },
];

export const MOVE_TOGETHER_STEPS: ReadonlyArray<Step<SelectionMoveTogetherAxis>> = [
  {
    id: 'arrange.move-together-horizontal',
    value: 'horizontal',
    label: 'Move H Together',
    title: 'Close the gaps so the selection sits side by side',
  },
  {
    id: 'arrange.move-together-vertical',
    value: 'vertical',
    label: 'Move V Together',
    title: 'Close the gaps so the selection stacks edge to edge',
  },
];

const DRAW_ORDER: ReadonlyArray<Spec> = DRAW_ORDER_STEPS.map(({ value, ...step }) => ({
  ...step,
  invoke: (ctx) => ctx.moveSelectionInDrawOrder(value),
}));

const MOVE_TOGETHER: ReadonlyArray<Spec> = MOVE_TOGETHER_STEPS.map(({ value, ...step }) => ({
  ...step,
  invoke: (ctx) => ctx.moveSelectionTogether(value),
}));

const REFERENCED: ReadonlyArray<Spec> = [
  {
    id: 'arrange.same-width',
    label: 'Make Same Width',
    title: 'Give every selected object the width of the reference object',
    invoke: (ctx) => ctx.matchSelectionSize('width', false),
  },
  {
    id: 'arrange.same-height',
    label: 'Make Same Height',
    title: 'Give every selected object the height of the reference object',
    invoke: (ctx) => ctx.matchSelectionSize('height', false),
  },
  {
    id: 'arrange.same-width-proportional',
    label: 'Make Same Width (Proportional)',
    title: 'Match the reference width and keep each object in proportion',
    invoke: (ctx) => ctx.matchSelectionSize('width', true),
  },
  {
    id: 'arrange.same-height-proportional',
    label: 'Make Same Height (Proportional)',
    title: 'Match the reference height and keep each object in proportion',
    invoke: (ctx) => ctx.matchSelectionSize('height', true),
  },
  ...MOVE_TOGETHER,
  {
    id: 'arrange.mirror-across-line',
    label: 'Mirror Across Line',
    title: 'Add a mirrored copy of the selection across the last selected straight line',
    invoke: (ctx) => ctx.mirrorSelectionAcrossLine(),
  },
];

export const DOCK_IDS: ReadonlyArray<LayoutCommandId> = [
  'arrange.dock-left',
  'arrange.dock-right',
  'arrange.dock-up',
  'arrange.dock-down',
  'arrange.dock-options',
];

const DOCK: ReadonlyArray<Spec> = (['left', 'right', 'up', 'down'] as const).map((direction) => ({
  id: `arrange.dock-${direction}`,
  label: `Dock ${direction[0]?.toUpperCase()}${direction.slice(1)}`,
  title: `Slide the selection ${direction} until it meets other artwork or the bed edge`,
  invoke: (ctx) => ctx.dockSelection(direction),
}));

const TWO_POINT: Spec = {
  id: 'arrange.two-point-rotate-scale',
  label: 'Two-Point Rotate / Scale',
  title: 'Click a pivot, a reference point and its new place to turn the selection',
  invoke: (ctx) => ctx.startTwoPointTransform(),
};

const TANGENT_CIRCLE: Spec = {
  id: 'tools.tangent-circle',
  family: 'tools',
  label: 'Tangent Circle...',
  title: 'Add a circle that touches all three selected circles',
  invoke: (ctx) => ctx.tangentCircle(),
};

const CLOSE_WITH_TOLERANCE: Spec = {
  id: 'tools.close-paths-with-tolerance',
  family: 'tools',
  label: 'Close Paths With Tolerance...',
  title: 'Close the open paths whose ends lie within a chosen gap',
  invoke: (ctx) => ctx.closePathsWithTolerance(),
};

const SHEAR: Spec = {
  id: 'tools.shear',
  family: 'tools',
  label: 'Shear...',
  title: 'Slant the selection horizontally or vertically about its centre',
  invoke: (ctx) => ctx.shear(),
};

export const GUIDE_IDS: ReadonlyArray<LayoutCommandId> = [
  'window.lock-guides',
  'window.clear-guides',
];

const CLEAR_GUIDES: Spec = {
  id: 'window.clear-guides',
  family: 'window',
  label: 'Clear Guidelines',
  title: 'Remove every guideline from the project',
  invoke: (ctx) => ctx.clearGuides(),
};

const RADIUS_FILLET: Spec = {
  id: 'tools.radius-fillet',
  family: 'tools',
  label: 'Radius / Fillet...',
  title: 'Round, bite or sharpen the corners of the selection',
  invoke: (ctx) => ctx.radiusFillet(),
};

export function layoutCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ...DRAW_ORDER.map((spec) =>
      command(ctx, spec, ctx.hasSelection, 'Select the artwork to restack first.'),
    ),
    command(ctx, TWO_POINT, ctx.hasSelection, 'Select the artwork to rotate or scale first.'),
    ...DOCK.map((spec) =>
      command(ctx, spec, ctx.hasSelection, 'Select the artwork to dock first.'),
    ),
    enabled(
      'arrange.dock-options',
      'arrange',
      'Docking Options...',
      'Set the docking padding, Move as group and Lock inner objects',
      ctx.dockOptions,
    ),
    command(ctx, TANGENT_CIRCLE, ctx.hasThreeCircles, 'Select exactly three circles first.'),
    ...[CLOSE_WITH_TOLERANCE, RADIUS_FILLET, SHEAR].map((spec) =>
      command(
        ctx,
        spec,
        ctx.canEditSelectedPaths,
        'Select imported, traced or drawn-line artwork first.',
      ),
    ),
    enabled(
      'window.lock-guides',
      'window',
      ctx.guidesLocked ? 'Unlock Guidelines' : 'Lock Guidelines',
      ctx.guidesLocked
        ? 'Let guidelines be pulled from the rulers and moved again'
        : 'Stop guidelines being pulled from the rulers or moved',
      ctx.toggleGuidesLocked,
    ),
    command(ctx, CLEAR_GUIDES, ctx.hasGuides, 'The project has no guidelines.'),
    ...REFERENCED.map((spec) =>
      command(
        ctx,
        spec,
        ctx.canAlignSelection,
        'Select at least two objects or groups. The last one clicked is the reference.',
      ),
    ),
  ];
}

function command(ctx: AppCommandContext, spec: Spec, on: boolean, reason: string): AppCommand {
  const invoke = () => spec.invoke(ctx);
  const family = spec.family ?? 'arrange';
  const shortcut = arrangeShortcutLabel(spec.id);
  return on
    ? enabled(spec.id, family, spec.label, spec.title, invoke, shortcut)
    : disabled(spec.id, family, spec.label, reason, invoke, shortcut);
}
