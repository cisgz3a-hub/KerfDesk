// Opening or saving a project file puts it at the top of Recent Projects
// (ADR-378). Recording is best effort: it never delays, fails or changes the
// open or save that triggered it. A platform without Recent Projects support
// (tests, or a host that cannot reopen files) records nothing.

import type { PlatformAdapter, RecentFileRef } from '../../platform/types';
import { useRecentProjectsStore } from './recent-projects-store';

export type RememberedProjectFile = {
  readonly name: string;
  readonly recentRef?: RecentFileRef | undefined;
};

export function rememberRecentProject(
  platform: Pick<PlatformAdapter, 'recentFiles'>,
  file: RememberedProjectFile,
): void {
  const files = platform.recentFiles;
  if (files === undefined) return;
  void useRecentProjectsStore
    .getState()
    .record(files, { name: file.name, ref: file.recentRef ?? null })
    .catch(() => undefined);
}

/** After an open: only a file that replaced the document is remembered. */
export function rememberOpenedProject(
  platform: Pick<PlatformAdapter, 'recentFiles'>,
  file: RememberedProjectFile,
  opened: boolean,
): void {
  if (opened) rememberRecentProject(platform, file);
}
