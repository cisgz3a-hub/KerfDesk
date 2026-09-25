// Recent Projects and operating-system opens in the desktop renderer
// (ADR-378). Files picked in the app are File System Access handles, exactly
// as on the web, and go to the handle adapter passed in. A file the operating
// system opened arrives as { path, token } from main, and is read back
// through main's exact app:// routes; main refuses any path it did not hand
// over. Every response is untrusted and parsed fail-closed.

import type {
  ExternalFileOpenRequest,
  ExternalFileOpenSource,
  FileHandle,
  RecentFileAdapter,
  RecentFileOpenResult,
  RecentFileProbe,
  RecentFileRef,
} from '../types';
import { parseDesktopOpenRequests, parseDesktopProbe } from './desktop-project-responses';

export const DESKTOP_PROJECT_OPEN_EVENT = 'kerfdesk:desktop-project-open';

const FILE_ROUTE = './api/desktop-project-file';
const STATUS_ROUTE = './api/desktop-project-status';
const OPENS_ROUTE = './api/desktop-project-opens';
// File.lastModified is whole milliseconds; main's mtimeMs keeps the fraction.
const MODIFIED_TOLERANCE_MS = 1.5;

type DesktopPathRef = Extract<RecentFileRef, { kind: 'desktop-path' }>;
type HandleRef = Extract<RecentFileRef, { kind: 'handle' }>;
type RouteFetch = (input: string, init: RequestInit) => Promise<Response>;
type Listener = (request: ExternalFileOpenRequest) => void;

export type DesktopProjectFiles = {
  readonly recentFiles: RecentFileAdapter;
  readonly externalFileOpens: ExternalFileOpenSource;
};

export type DesktopProjectFileOptions = {
  readonly fetchRoute?: RouteFetch;
  readonly events?: EventTarget;
};

const GET_INIT: RequestInit = { method: 'GET', cache: 'no-store', credentials: 'same-origin' };

export function createDesktopProjectFiles(
  handleFiles: RecentFileAdapter | undefined,
  options: DesktopProjectFileOptions = {},
): DesktopProjectFiles {
  const fetchRoute = options.fetchRoute ?? ((input, init) => fetch(input, init));
  const pathFiles = desktopPathFiles(fetchRoute);
  return {
    recentFiles: {
      open: (ref) =>
        ref.kind === 'desktop-path' ? pathFiles.open(ref) : openHandle(handleFiles, ref),
      probe: (ref) =>
        ref.kind === 'desktop-path'
          ? pathFiles.probe(ref)
          : (handleFiles?.probe(ref) ?? Promise.resolve<RecentFileProbe>({ kind: 'unknown' })),
      isSameFile: (left, right) => sameFile(left, right, handleFiles, pathFiles.probe),
    },
    externalFileOpens: desktopExternalOpens(fetchRoute, options.events ?? window),
  };
}

function openHandle(
  handleFiles: RecentFileAdapter | undefined,
  ref: RecentFileRef,
): Promise<RecentFileOpenResult> {
  if (handleFiles === undefined) {
    return Promise.resolve({ kind: 'failed', message: 'this file cannot be reopened here.' });
  }
  return handleFiles.open(ref);
}

function desktopPathFiles(fetchRoute: RouteFetch): {
  readonly open: (ref: DesktopPathRef) => Promise<RecentFileOpenResult>;
  readonly probe: (ref: DesktopPathRef) => Promise<RecentFileProbe>;
} {
  return {
    open: async (ref) => {
      try {
        const response = await fetchRoute(pathRoute(FILE_ROUTE, ref), GET_INIT);
        if (response.ok) {
          const blob = await response.blob();
          return { kind: 'opened', file: blobFileHandle(ref, blob) };
        }
        return openFailure(response.status);
      } catch {
        return { kind: 'failed', message: failureMessage(0) };
      }
    },
    probe: async (ref) => {
      try {
        const response = await fetchRoute(pathRoute(STATUS_ROUTE, ref), GET_INIT);
        return response.ok ? parseDesktopProbe(await response.json()) : { kind: 'unknown' };
      } catch {
        return { kind: 'unknown' };
      }
    },
  };
}

function openFailure(status: number): RecentFileOpenResult {
  if (status === 404) return { kind: 'missing' };
  if (status === 403) return { kind: 'denied' };
  return { kind: 'failed', message: failureMessage(status) };
}

function failureMessage(status: number): string {
  if (status === 404) return 'the file is no longer there.';
  if (status === 403) return 'KerfDesk is no longer allowed to read it.';
  if (status === 415) return 'it is not a KerfDesk or LightBurn project file.';
  return 'KerfDesk could not read it.';
}

/** The same file reached two ways: picked in the app (a handle) and opened
 * from Explorer (a path). Names must match; then size and modification time
 * must, as far as each side can tell without a permission prompt. */
async function sameFile(
  left: RecentFileRef,
  right: RecentFileRef,
  handleFiles: RecentFileAdapter | undefined,
  probePath: (ref: DesktopPathRef) => Promise<RecentFileProbe>,
): Promise<boolean> {
  if (left.kind === 'desktop-path' && right.kind === 'desktop-path') {
    return sameDesktopPath(left.path, right.path);
  }
  if (handleFiles === undefined) return false;
  if (left.kind === 'handle' && right.kind === 'handle') return handleFiles.isSameFile(left, right);
  const handleRef = [left, right].find((ref): ref is HandleRef => ref.kind === 'handle');
  const pathRef = [left, right].find((ref): ref is DesktopPathRef => ref.kind === 'desktop-path');
  if (handleRef === undefined || pathRef === undefined) return false;
  if (handleRef.handle.name.toLowerCase() !== fileName(pathRef.path).toLowerCase()) return false;
  const [pathFacts, handleFacts] = await Promise.all([
    probePath(pathRef),
    handleFiles.probe(handleRef),
  ]);
  return sameFacts(pathFacts, handleFacts);
}

function sameFacts(left: RecentFileProbe, right: RecentFileProbe): boolean {
  return (
    left.kind === 'present' &&
    right.kind === 'present' &&
    left.size === right.size &&
    Math.abs(left.modifiedMs - right.modifiedMs) < MODIFIED_TOLERANCE_MS
  );
}

/** Windows paths compare without case, as the file system does. */
export function sameDesktopPath(left: string, right: string): boolean {
  if (isWindowsPath(left) || isWindowsPath(right)) {
    return left.replaceAll('/', '\\').toLowerCase() === right.replaceAll('/', '\\').toLowerCase();
  }
  return left === right;
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function fileName(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

function pathRoute(route: string, ref: DesktopPathRef): string {
  return `${route}?${new URLSearchParams({ path: ref.path, token: ref.token }).toString()}`;
}

function blobFileHandle(ref: DesktopPathRef, blob: Blob): FileHandle {
  return {
    name: fileName(ref.path),
    size: blob.size,
    text: () => blob.text(),
    blob: async () => blob,
    recentRef: ref,
  };
}

/** Reads the file only when the open actually runs, which may be after a job. */
function lazyFileHandle(fetchRoute: RouteFetch, ref: DesktopPathRef, size: number): FileHandle {
  let pending: Promise<Blob> | undefined;
  const read = (): Promise<Blob> => {
    pending ??= fetchRoute(pathRoute(FILE_ROUTE, ref), GET_INIT).then((response) => {
      if (response.ok) return response.blob();
      throw new Error(failureMessage(response.status));
    });
    return pending;
  };
  return {
    name: fileName(ref.path),
    size,
    text: async () => (await read()).text(),
    blob: read,
    recentRef: ref,
  };
}

function desktopExternalOpens(fetchRoute: RouteFetch, events: EventTarget): ExternalFileOpenSource {
  const listeners = new Set<Listener>();
  const waiting: ExternalFileOpenRequest[] = [];
  let draining: Promise<void> | null = null;
  let drainAgain = false;

  const deliver = (request: ExternalFileOpenRequest): void => {
    if (listeners.size === 0) waiting.push(request);
    for (const listener of listeners) listener(request);
  };

  const drainOnce = async (): Promise<void> => {
    try {
      const response = await fetchRoute(OPENS_ROUTE, GET_INIT);
      if (!response.ok) return;
      for (const request of parseDesktopOpenRequests(await response.json())) {
        deliver(
          request.kind === 'file'
            ? { kind: 'file', file: lazyFileHandle(fetchRoute, request.ref, request.size) }
            : request,
        );
      }
    } catch {
      // Outside the packaged app (development server) the route is absent.
    }
  };

  // Signals can arrive while a drain is in flight; run one more after it.
  const drain = (): void => {
    if (draining !== null) {
      drainAgain = true;
      return;
    }
    draining = drainOnce().finally(() => {
      draining = null;
      if (drainAgain) {
        drainAgain = false;
        drain();
      }
    });
  };

  let installed = false;
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      for (const request of waiting.splice(0)) listener(request);
      if (!installed) {
        installed = true;
        events.addEventListener(DESKTOP_PROJECT_OPEN_EVENT, drain);
      }
      drain();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
