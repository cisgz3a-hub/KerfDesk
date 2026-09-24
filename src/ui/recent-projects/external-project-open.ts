// Project files the operating system hands over (ADR-378): a double-click in
// Explorer, a file named on the command line, or the installed web app's file
// handler. Each goes through the unsaved-changes guard exactly like File >
// Open. One never replaces the project under a running job or an open dialog
// (Job Review, Machine Setup, another unsaved-changes question): the file
// waits in a banner and opens when the operator asks, once the job is over.

import { create } from 'zustand';
import type {
  ExternalFileOpenRequest,
  ExternalFileOpenSource,
  FileHandle,
  PlatformAdapter,
} from '../../platform/types';
import { errorMessage } from '../app/file-action-formatters';
import { openProjectCommand } from '../commands/open-project-command';
import type { ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

type PendingProjectOpenState = {
  /** The newest file that arrived during a job; an older one is replaced. */
  readonly file: FileHandle | null;
  readonly hold: (file: FileHandle) => void;
  readonly take: () => FileHandle | null;
  readonly dismiss: () => void;
};

export const usePendingProjectOpenStore = create<PendingProjectOpenState>((set, get) => ({
  file: null,
  hold: (file) => set({ file }),
  take: () => {
    const file = get().file;
    set({ file: null });
    return file;
  },
  dismiss: () => set({ file: null }),
}));

export type ExternalProjectOpenDeps = {
  readonly platform: PlatformAdapter;
  readonly pushToast: PushToast;
  readonly jobActive: () => boolean;
  /** A modal dialog is open over the project. */
  readonly dialogOpen: () => boolean;
};

export async function handleExternalProjectOpen(
  request: ExternalFileOpenRequest,
  deps: ExternalProjectOpenDeps,
): Promise<void> {
  if (request.kind === 'unavailable') {
    deps.pushToast(unavailableMessage(request), 'error');
    return;
  }
  const file = request.file;
  const hold = (): void => usePendingProjectOpenStore.getState().hold(file);
  if (deps.jobActive() || deps.dialogOpen()) {
    hold();
    return;
  }
  // Asked again once the unsaved-changes question is answered: a job can be
  // started while it is open.
  const stillAllowed = (): boolean => {
    if (!deps.jobActive()) return true;
    hold();
    return false;
  };
  try {
    await openProjectCommand(deps.platform, deps.pushToast, { file, stillAllowed });
  } catch (error) {
    deps.pushToast(`Could not open ${file.name}: ${errorMessage(error)}`, 'error');
  }
}

/** Opens one handed-over file at a time, in arrival order. */
export function subscribeExternalProjectOpens(
  source: ExternalFileOpenSource,
  deps: ExternalProjectOpenDeps,
): () => void {
  let queue: Promise<void> = Promise.resolve();
  return source.subscribe((request) => {
    queue = queue.then(() => handleExternalProjectOpen(request, deps)).catch(() => undefined);
  });
}

function unavailableMessage(
  request: Extract<ExternalFileOpenRequest, { kind: 'unavailable' }>,
): string {
  switch (request.reason) {
    case 'missing':
      return `Could not open ${request.name}: the file is no longer there.`;
    case 'invalid':
      return `Could not open ${request.name}: it is not a KerfDesk or LightBurn project file.`;
    case 'unreadable':
      return `Could not open ${request.name}: KerfDesk could not read it.`;
  }
}
