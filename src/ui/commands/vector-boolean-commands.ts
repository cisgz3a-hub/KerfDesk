// Boolean combine commands (ADR-103 G1) — Subtract / Intersect / Exclude,
// siblings of tools.weld (union). Machine-agnostic geometry: available in
// both laser and CNC modes. The bottom-most selected object is the subject.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

const NEEDS_SELECTION = 'Select two or more unlocked closed vector shapes first.';

export function vectorBooleanCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ctx.canWeldSelection
      ? enabled(
          'tools.union-silhouette',
          'tools',
          'Union silhouette...',
          'Combine shapes into one silhouette using a chosen result operation',
          ctx.unionSilhouette,
        )
      : disabled(
          'tools.union-silhouette',
          'tools',
          'Union silhouette...',
          'Select unlocked closed vector shapes first.',
          ctx.unionSilhouette,
        ),
    ctx.canJoinPaths
      ? enabled(
          'tools.join-paths',
          'tools',
          'Join paths...',
          'Join nearby endpoints with matching operations and settings',
          ctx.joinPaths,
        )
      : disabled(
          'tools.join-paths',
          'tools',
          'Join paths...',
          'Select unlocked vector artwork with open paths.',
          ctx.joinPaths,
        ),
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
