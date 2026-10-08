import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function jointResizeCommand(ctx: AppCommandContext): AppCommand {
  const invoke = ctx.resizeJoints ?? (() => undefined);
  return ctx.hasSelection && ctx.resizeJoints !== undefined
    ? enabled(
        'tools.resize-joints',
        'tools',
        'Resize Joint Openings…',
        'Review straight receiving slots and notches against measured material thickness',
        invoke,
      )
    : disabled(
        'tools.resize-joints',
        'tools',
        'Resize Joint Openings…',
        'Select imported or traced vector artwork first.',
        invoke,
      );
}
