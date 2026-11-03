import { useUnsavedWorkStore } from '../app/unsaved-work-store';
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

// File > Recover unsaved work (ADR-688). Always available: the list says when
// no earlier session left unsaved work.
export function unsavedWorkCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'file.recover-unsaved',
    'file',
    'Recover unsaved work...',
    'Restore work from an earlier session that was never saved',
    ctx.openUnsavedWork,
  );
}

export function recentProjectsCommandContext(): Pick<
  AppCommandContext,
  'openRecentProjects' | 'openUnsavedWork'
> {
  return {
    openRecentProjects: () => useRecentProjectsStore.getState().openDialog(),
    openUnsavedWork: () => useUnsavedWorkStore.getState().openDialog(),
  };
}
