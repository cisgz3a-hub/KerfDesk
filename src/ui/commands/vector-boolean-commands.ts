// Boolean combine commands (ADR-103 G1) — Subtract / Intersect / Exclude,
// siblings of tools.weld (union). Machine-agnostic geometry: available in
// both laser and CNC modes. The first-selected shape or group is the subject
// and a group is one operand (ADR-377).

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

const NEEDS_SELECTION = 'Select two or more unlocked closed vector shapes or groups first.';

export function vectorBooleanCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ctx.canUnionSilhouette
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
          'Cut the later-selected shapes out of the first one you selected',
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
    ctx.hasSelection
      ? enabled(
          'tools.rubber-band-outline',
          'tools',
          'Rubber-band outline',
          'Wrap the selection in its tightest convex outline on a new Line operation',
          ctx.createRubberBandOutline,
        )
      : disabled(
          'tools.rubber-band-outline',
          'tools',
          'Rubber-band outline',
          'Select artwork to wrap first.',
          ctx.createRubberBandOutline,
        ),
  ];
}
