// Boolean combine commands (ADR-102 G1) — Subtract / Intersect / Exclude,
// siblings of tools.weld (union). Machine-agnostic geometry: available in
// both laser and CNC modes. The bottom-most selected object is the subject.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

const NEEDS_SELECTION = 'Select two or more unlocked closed vector shapes first.';

export function vectorBooleanCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ctx.canCombineSelection
      ? enabled(
          'tools.subtract',
          'tools',
          'Subtract',
          'Cut the upper selected shapes out of the bottom-most one',
          ctx.subtractSelection,
        )
      : disabled('tools.subtract', 'tools', 'Subtract', NEEDS_SELECTION, ctx.subtractSelection),
    ctx.canCombineSelection
      ? enabled(
          'tools.intersect',
          'tools',
          'Intersect',
          'Keep only the area shared by all selected shapes',
          ctx.intersectSelection,
        )
      : disabled('tools.intersect', 'tools', 'Intersect', NEEDS_SELECTION, ctx.intersectSelection),
    ctx.canCombineSelection
      ? enabled(
          'tools.exclude',
          'tools',
          'Exclude',
          'Keep everything except the overlap of the selected shapes',
          ctx.excludeSelection,
        )
      : disabled('tools.exclude', 'tools', 'Exclude', NEEDS_SELECTION, ctx.excludeSelection),
  ];
}
