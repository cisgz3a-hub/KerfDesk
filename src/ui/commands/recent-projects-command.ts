import { useRecentProjectsStore } from '../recent-projects/recent-projects-store';
import { enabled, type AppCommand, type AppCommandContext } from './command-types';

// File > Recent Projects (ADR-378). Always available, like File > Open: the
// manager shows an empty list until a project is opened or saved.
export function recentProjectsCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'file.open-recent',
    'file',
    'Recent Projects...',
    'Reopen, pin or remove recent projects',
    ctx.openRecentProjects,
  );
}

export function recentProjectsCommandContext(): Pick<AppCommandContext, 'openRecentProjects'> {
  return { openRecentProjects: () => useRecentProjectsStore.getState().openDialog() };
}
