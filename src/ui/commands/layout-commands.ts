// LightBurn parity layout commands in the Arrange menu: Change Draw Order,
// Make Same Width / Height and Move H / V Together.

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
};

const DRAW_ORDER: ReadonlyArray<Spec> = [
  {
    id: 'arrange.bring-to-front',
    label: 'Bring to Front',
    title: 'Draw the selection on top of all other artwork',
    invoke: (ctx) => ctx.moveSelectionInDrawOrder('front'),
  },
  {
    id: 'arrange.bring-forward',
    label: 'Bring Forward',
    title: 'Draw the selection one step higher',
    invoke: (ctx) => ctx.moveSelectionInDrawOrder('forward'),
  },
  {
    id: 'arrange.send-backward',
    label: 'Send Backward',
    title: 'Draw the selection one step lower',
    invoke: (ctx) => ctx.moveSelectionInDrawOrder('backward'),
  },
  {
    id: 'arrange.send-to-back',
    label: 'Send to Back',
    title: 'Draw the selection behind all other artwork',
    invoke: (ctx) => ctx.moveSelectionInDrawOrder('back'),
  },
];

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
  {
    id: 'arrange.move-together-horizontal',
    label: 'Move H Together',
    title: 'Close the gaps so the selection sits side by side',
    invoke: (ctx) => ctx.moveSelectionTogether('horizontal'),
  },
  {
    id: 'arrange.move-together-vertical',
    label: 'Move V Together',
    title: 'Close the gaps so the selection stacks edge to edge',
    invoke: (ctx) => ctx.moveSelectionTogether('vertical'),
  },
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
    ctx.hasThreeCircles
      ? enabled(
          'tools.tangent-circle',
          'tools',
          'Tangent Circle...',
          'Add a circle that touches all three selected circles',
          ctx.tangentCircle,
        )
      : disabled(
          'tools.tangent-circle',
          'tools',
          'Tangent Circle...',
          'Select exactly three circles first.',
          ctx.tangentCircle,
        ),
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
  return on
    ? enabled(spec.id, 'arrange', spec.label, spec.title, invoke)
    : disabled(spec.id, 'arrange', spec.label, reason, invoke);
}
