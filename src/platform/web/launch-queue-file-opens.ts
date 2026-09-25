// Project files handed to the installed web app (ADR-378). The manifest's
// file_handlers entry lets Chromium list KerfDesk under "Open with" for .lf2,
// and launch_handler 'focus-existing' delivers a double-click to the window
// that is already open through window.launchQueue instead of loading a second
// copy of the app. Browsers without the Launch Handler API never call the
// consumer, so they are unaffected.

import type { ExternalFileOpenRequest, ExternalFileOpenSource } from '../types';
import { fileHandleFromFile } from './recent-file-handles';

const PROJECT_FILE = /\.(?:lf2|lbrn2?)$/i;

type LaunchParams = { readonly files?: ReadonlyArray<FileSystemHandle> };
type LaunchQueue = { readonly setConsumer: (consumer: (params: LaunchParams) => void) => void };
type LaunchHost = { readonly launchQueue?: LaunchQueue };
type Listener = (request: ExternalFileOpenRequest) => void;

export function createLaunchQueueFileOpens(
  host: () => LaunchHost | undefined = () =>
    typeof window === 'undefined' ? undefined : (window as unknown as LaunchHost),
): ExternalFileOpenSource {
  const listeners = new Set<Listener>();
  const waiting: ExternalFileOpenRequest[] = [];
  let installed = false;

  const deliver = (request: ExternalFileOpenRequest): void => {
    if (listeners.size === 0) waiting.push(request);
    for (const listener of listeners) listener(request);
  };

  const install = (): void => {
    if (installed) return;
    installed = true;
    const queue = host()?.launchQueue;
    if (typeof queue?.setConsumer !== 'function') return;
    // Delivered in launch order, whichever file finishes reading first.
    queue.setConsumer((params) => {
      void Promise.all((params.files ?? []).map(launchRequest)).then((requests) => {
        for (const request of requests) deliver(request);
      });
    });
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      install();
      for (const request of waiting.splice(0)) listener(request);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

async function launchRequest(handle: FileSystemHandle): Promise<ExternalFileOpenRequest> {
  if (handle.kind !== 'file' || !PROJECT_FILE.test(handle.name)) {
    return { kind: 'unavailable', name: handle.name, reason: 'invalid' };
  }
  const fileHandle = handle as FileSystemFileHandle;
  try {
    return { kind: 'file', file: fileHandleFromFile(fileHandle, await fileHandle.getFile()) };
  } catch (error) {
    const missing = error instanceof Error && error.name === 'NotFoundError';
    return { kind: 'unavailable', name: handle.name, reason: missing ? 'missing' : 'unreadable' };
  }
}
