// A project file dropped on the window opens exactly like one the operating
// system hands over (ADR-378 Amendment 1): behind the unsaved-changes
// question, and never over a running job or an open dialog, where it waits in
// the banner instead.

import type { FileHandle, PlatformAdapter } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { handleExternalProjectOpen, type ExternalProjectOpenDeps } from './external-project-open';

const PROJECT_FILE = /\.(lf2|lbrn2?)$/i;

export function isProjectFileName(name: string): boolean {
  return PROJECT_FILE.test(name);
}

/** What guards a project that arrives from outside the File menu. */
export function appProjectOpenDeps(platform: PlatformAdapter): ExternalProjectOpenDeps {
  return {
    platform,
    pushToast: (message, variant) => useToastStore.getState().pushToast(message, variant),
    jobActive: () => isActiveJob(useLaserStore.getState().streamer),
    dialogOpen: () => useUiStore.getState().modalDepth > 0,
  };
}

/**
 * Opens the first project file in a drop and returns true, or returns false
 * when the drop holds none. The other files in that drop are not imported:
 * the project replaces the document they would have joined.
 */
export function openDroppedProject(
  files: ReadonlyArray<File>,
  deps: ExternalProjectOpenDeps,
): boolean {
  const project = files.find((file) => isProjectFileName(file.name));
  if (project === undefined) return false;
  const others = files.length - 1;
  if (others > 0) {
    deps.pushToast(
      `Opening ${project.name}. Ignored ${others} other dropped file(s); drop artwork again once the project opens.`,
      'warning',
    );
  }
  void handleExternalProjectOpen({ kind: 'file', file: droppedFileHandle(project) }, deps).catch(
    () => undefined,
  );
  return true;
}

function droppedFileHandle(file: File): FileHandle {
  return {
    name: file.name,
    size: file.size,
    text: () => file.text(),
    blob: async () => file,
  };
}
