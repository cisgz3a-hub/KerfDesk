import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function arrangeCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const align = ALIGN_COMMANDS.map((spec) =>
    ctx.canAlignSelection
      ? enabled(spec.id, 'arrange', spec.label, spec.title, () => ctx.alignSelection(spec.kind))
      : disabled(spec.id, 'arrange', spec.label, 'Select at least two objects to align.', () =>
          ctx.alignSelection(spec.kind),
        ),
  );
  const distribute = DISTRIBUTE_COMMANDS.map((spec) =>
    ctx.canDistributeSelection
      ? enabled(spec.id, 'arrange', spec.label, spec.title, () =>
          ctx.distributeSelection(spec.kind),
        )
      : disabled(
          spec.id,
          'arrange',
          spec.label,
          'Select at least three objects to distribute.',
          () => ctx.distributeSelection(spec.kind),
        ),
  );
  return [...align, ...distribute, flipHorizontalCommand(ctx), flipVerticalCommand(ctx)];
}

function flipHorizontalCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canTransformSelection
    ? enabled(
        'arrange.flip-horizontal',
        'arrange',
        'Flip Horizontal',
        'Flip selection horizontally',
        ctx.flipHorizontal,
        'H',
      )
    : disabled(
        'arrange.flip-horizontal',
        'arrange',
        'Flip Horizontal',
        'Select an object to flip.',
        ctx.flipHorizontal,
        'H',
      );
}

function flipVerticalCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canTransformSelection
    ? enabled(
        'arrange.flip-vertical',
        'arrange',
        'Flip Vertical',
        'Flip selection vertically',
        ctx.flipVertical,
        'V',
      )
    : disabled(
        'arrange.flip-vertical',
        'arrange',
        'Flip Vertical',
        'Select an object to flip.',
        ctx.flipVertical,
        'V',
      );
}

const ALIGN_COMMANDS = [
  {
    id: 'arrange.align-left',
    kind: 'left',
    label: 'Align Left',
    title: 'Align selected objects to the reference left edge',
  },
  {
    id: 'arrange.align-center-x',
    kind: 'center-x',
    label: 'Align Center X',
    title: 'Align selected objects to the reference vertical center',
  },
  {
    id: 'arrange.align-right',
    kind: 'right',
    label: 'Align Right',
    title: 'Align selected objects to the reference right edge',
  },
  {
    id: 'arrange.align-top',
    kind: 'top',
    label: 'Align Top',
    title: 'Align selected objects to the reference top edge',
  },
  {
    id: 'arrange.align-center-y',
    kind: 'center-y',
    label: 'Align Center Y',
    title: 'Align selected objects to the reference horizontal center',
  },
  {
    id: 'arrange.align-bottom',
    kind: 'bottom',
    label: 'Align Bottom',
    title: 'Align selected objects to the reference bottom edge',
  },
  {
    id: 'arrange.align-centers',
    kind: 'centers',
    label: 'Align Centers',
    title: 'Center selected objects over the reference object',
  },
] as const;

const DISTRIBUTE_COMMANDS = [
  {
    id: 'arrange.distribute-horizontal-centers',
    kind: 'horizontal-centers',
    label: 'Distribute H Centers',
    title: 'Evenly space selected object centers horizontally',
  },
  {
    id: 'arrange.distribute-horizontal-spacing',
    kind: 'horizontal-spacing',
    label: 'Distribute H Spacing',
    title: 'Evenly space selected object edges horizontally',
  },
  {
    id: 'arrange.distribute-vertical-centers',
    kind: 'vertical-centers',
    label: 'Distribute V Centers',
    title: 'Evenly space selected object centers vertically',
  },
  {
    id: 'arrange.distribute-vertical-spacing',
    kind: 'vertical-spacing',
    label: 'Distribute V Spacing',
    title: 'Evenly space selected object edges vertically',
  },
] as const;
