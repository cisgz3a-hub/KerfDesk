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
];

export function layoutCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ...DRAW_ORDER.map((spec) =>
      command(ctx, spec, ctx.hasSelection, 'Select the artwork to restack first.'),
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
