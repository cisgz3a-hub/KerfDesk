import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function templateCommands(ctx: AppCommandContext): readonly AppCommand[] {
  return [
    enabled(
      'file.open-template',
      'file',
      'Open template...',
      'Start a new project from a protected template',
      ctx.openTemplate,
    ),
    enabled(
      'file.save-template',
      'file',
      'Save template...',
      'Save artwork, notes and settings as a reusable project template',
      ctx.saveTemplate,
    ),
  ];
}
