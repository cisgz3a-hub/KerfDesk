// Recent Projects over File System Access handles (ADR-378), for the web app
// and the desktop file pickers alike. A handle kept in IndexedDB survives a
// restart, but Chromium resets its read permission to 'prompt' and only lets a
// page ask again during a user gesture. open() therefore asks, and must run
// from the operator's click; probe() never asks.

import type {
  FileHandle,
  RecentFileAdapter,
  RecentFileOpenResult,
  RecentFileProbe,
  RecentFileRef,
} from '../types';

type HandlePermission = 'granted' | 'denied' | 'prompt';
type ReadPermissionDescriptor = { readonly mode: 'read' };

// Not in lib.dom yet; present on Chromium handles.
type PermissionCapableHandle = {
  readonly queryPermission?: (descriptor: ReadPermissionDescriptor) => Promise<HandlePermission>;
  readonly requestPermission?: (descriptor: ReadPermissionDescriptor) => Promise<HandlePermission>;
};

/** A picked or launched file, remembered by its handle. */
export function fileHandleFromFile(handle: FileSystemFileHandle, file: File): FileHandle {
  return {
    name: file.name,
    size: file.size,
    text: () => file.text(),
    blob: async () => file,
    recentRef: { kind: 'handle', handle },
  };
}

export const webRecentFiles: RecentFileAdapter = {
  open: openHandle,
  probe: probeHandle,
  isSameFile: sameHandle,
};

async function openHandle(ref: RecentFileRef): Promise<RecentFileOpenResult> {
  if (ref.kind !== 'handle') {
    return { kind: 'failed', message: 'This entry can only be reopened by the desktop app.' };
  }
  try {
    if (!(await hasReadPermission(ref.handle, true))) return { kind: 'denied' };
    return { kind: 'opened', file: fileHandleFromFile(ref.handle, await ref.handle.getFile()) };
  } catch (error) {
    return openFailure(error);
  }
}

async function probeHandle(ref: RecentFileRef): Promise<RecentFileProbe> {
  if (ref.kind !== 'handle') return { kind: 'unknown' };
  try {
    if (!(await hasReadPermission(ref.handle, false))) return { kind: 'unknown' };
    const file = await ref.handle.getFile();
    return { kind: 'present', size: file.size, modifiedMs: file.lastModified };
  } catch (error) {
    return { kind: errorName(error) === 'NotFoundError' ? 'missing' : 'unknown' };
  }
}

async function sameHandle(left: RecentFileRef, right: RecentFileRef): Promise<boolean> {
  if (left.kind !== 'handle' || right.kind !== 'handle') return false;
  if (left.handle === right.handle) return true;
  if (typeof left.handle.isSameEntry !== 'function') return false;
  try {
    return await left.handle.isSameEntry(right.handle);
  } catch {
    return false;
  }
}

async function hasReadPermission(handle: FileSystemFileHandle, ask: boolean): Promise<boolean> {
  const permissions = handle as unknown as PermissionCapableHandle;
  // No permission model (older engines): reading reports any refusal itself.
  if (typeof permissions.queryPermission !== 'function') return true;
  if ((await permissions.queryPermission({ mode: 'read' })) === 'granted') return true;
  if (!ask || typeof permissions.requestPermission !== 'function') return false;
  return (await permissions.requestPermission({ mode: 'read' })) === 'granted';
}

function openFailure(error: unknown): RecentFileOpenResult {
  const name = errorName(error);
  if (name === 'NotFoundError') return { kind: 'missing' };
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
}

function errorName(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : null;
}
