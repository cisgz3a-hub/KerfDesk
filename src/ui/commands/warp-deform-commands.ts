// Tools -> Vector -> Warp and Deform (LightBurn gap LBG-T06). Each turns on a
// canvas tool over the selected vector artwork; the menu marks the one on.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import type { WarpDeformCommandId } from './warp-deform-command-types';

const NEEDS_VECTOR = 'Select unlocked vector artwork first.';

export function warpDeformCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    toolCommand(
      ctx,
      'tools.warp',
      'Warp',
      'Drag four corner handles to warp the selection in perspective',
      ctx.startWarp,
      ctx.warpToolActive,
    ),
    toolCommand(
      ctx,
      'tools.deform',
      'Deform',
      'Drag a grid of 16 handles to bend the selection smoothly',
      ctx.startDeform,
      ctx.deformToolActive,
    ),
  ];
}

function toolCommand(
  ctx: AppCommandContext,
  id: WarpDeformCommandId,
  label: string,
  title: string,
  invoke: () => void,
  active: boolean,
): AppCommand {
  const command = ctx.canWarpSelection
    ? enabled(id, 'tools', label, title, invoke)
    : disabled(id, 'tools', label, NEEDS_VECTOR, invoke);
  return { ...command, active };
}
