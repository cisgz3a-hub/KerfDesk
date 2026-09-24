// Reopening a Recent Projects entry (ADR-378). The file is read before the
// unsaved-changes guard runs: a browser shows its "allow KerfDesk to read
// this file?" prompt only straight after a click, and the guard's dialog
// would spend that click. A file that is gone, or that the operator will not
// let KerfDesk read, is reported in the Recent Projects manager, where the
// entry can be removed or the file chosen again.

import type { PlatformAdapter, RecentFileOpenResult } from '../../platform/types';
import { errorMessage } from '../app/file-action-formatters';
import { openProjectCommand } from '../commands/open-project-command';
import type { ToastVariant } from '../state/toast-store';
import { recentProjectFolder, type RecentProjectEntry } from './recent-project-model';
import { useRecentProjectsStore } from './recent-projects-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

export async function openRecentProject(
  platform: PlatformAdapter,
  entry: RecentProjectEntry,
  pushToast: PushToast,
): Promise<void> {
  const files = platform.recentFiles;
  if (entry.ref === null || files === undefined) {
    pushToast(
      `${entry.name} can't be reopened directly in this browser. Choose it in the file picker.`,
      'info',
    );
    await openProjectCommand(platform, pushToast);
    return;
  }
  const result = await files.open(entry.ref).catch(
    (error: unknown): RecentFileOpenResult => ({
      kind: 'failed',
      message: errorMessage(error),
    }),
  );
  const store = useRecentProjectsStore.getState();
  switch (result.kind) {
    case 'opened':
      store.setStatus(entry.id, 'present');
      await openProjectCommand(platform, pushToast, { file: result.file });
      return;
    case 'missing':
      store.setStatus(entry.id, 'missing');
      store.openDialog({ message: missingMessage(entry), offerPicker: true });
      return;
    case 'denied':
      store.openDialog({
        message: `KerfDesk isn't allowed to read ${entry.name}. Choose the file again to give permission.`,
        offerPicker: true,
      });
      return;
    case 'failed':
      pushToast(`Could not open ${entry.name}: ${result.message}`, 'error');
  }
}

function missingMessage(entry: RecentProjectEntry): string {
  const folder = recentProjectFolder(entry);
  const where = folder === null ? '' : ` in ${folder}`;
  return `${entry.name} is no longer${where}. It may have been moved, renamed or deleted. Choose it again, or remove it from the list.`;
}
