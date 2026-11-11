// Tools > Fill repair commands that act on a Fill's artwork: close near-closed
// contours (at the default gap, or reviewed at a larger one), and leave an
// older import's solid white unburned (ADR-686 Amendment 2).

import { CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM } from '../common/fill-diagnostics';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function fillRepairCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    closeOpenFillContoursCommand(ctx),
    reviewCloseOpenFillContoursCommand(ctx),
    leaveWhiteUnburnedCommand(ctx),
  ];
}

function closeOpenFillContoursCommand(ctx: AppCommandContext): AppCommand {
  const label = 'Close Open Fill Contours';
  return ctx.canCloseOpenFillContours
    ? enabled(
        'tools.close-open-fill-contours',
        'tools',
        label,
        'Close selected near-closed Fill contours',
        ctx.closeSelectedOpenFillContours,
      )
    : disabled(
        'tools.close-open-fill-contours',
        'tools',
        label,
        `Select open Fill contours with endpoints within ${CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM} mm.`,
        ctx.closeSelectedOpenFillContours,
      );
}

// ADR-686 Amendment 2: the knock-out a new import gets, for logos imported
// before it (rolling audit v10 V2-P2-1). One Undo step burns the white again.
function leaveWhiteUnburnedCommand(ctx: AppCommandContext): AppCommand {
  const label = 'Leave Imported White Unburned';
  return ctx.canLeaveWhiteUnburned
    ? enabled(
        'tools.leave-white-unburned',
        'tools',
        label,
        'Cut solid white SVG shapes out of the fills under them',
        ctx.leaveWhiteUnburned,
      )
    : disabled(
        'tools.leave-white-unburned',
        'tools',
        label,
        'No imported SVG burns solid white over a darker fill.',
        ctx.leaveWhiteUnburned,
      );
}

function reviewCloseOpenFillContoursCommand(ctx: AppCommandContext): AppCommand {
  const label = 'Close Fill Contours With Tolerance...';
  return ctx.canReviewCloseOpenFillContours
    ? enabled(
        'tools.close-fill-contours-with-tolerance',
        'tools',
        label,
        'Review selected open Fill contours before closing a larger endpoint gap',
        ctx.reviewCloseOpenFillContours,
      )
    : disabled(
        'tools.close-fill-contours-with-tolerance',
        'tools',
        label,
        'Select open Fill contours on an output Fill layer.',
        ctx.reviewCloseOpenFillContours,
      );
}
