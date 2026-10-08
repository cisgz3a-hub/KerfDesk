// webAdapter — PlatformAdapter backed by the File System Access API.
//
// PROJECT.md "Delivery targets" requires Chromium (Chrome, Edge, Brave, Arc),
// all of which ship the File System Access API. No download-fallback path:
// unsupported browsers fail clearly instead of creating a second persistence
// path outside the project/file contract.

import type {
  FileHandle,
  FileOpenRequest,
  FileSaveRequest,
  PlatformAdapter,
  RecentFileRef,
  SaveDestinationComparison,
  SaveDirectoryTarget,
  SaveTarget,
} from '../types';
import { saveDirectoryUnsupportedError } from '../types';
import { webCamera } from './web-camera';
import { webSerial } from './web-serial';
import { createHttpCameraBridge } from './camera-bridge';
import { createLaunchQueueFileOpens } from './launch-queue-file-opens';
import { fileHandleFromFile, webRecentFiles } from './recent-file-handles';
import { writeSaveChunks } from './write-save-chunks';

type FilePickerAcceptType = {
  description: string;
  accept: Record<string, string[]>;
};

function acceptTypesFor(accept: ReadonlyArray<string>): FilePickerAcceptType[] {
  // The File System Access API wants a map of MIME types → extensions. For
  // our use cases the extension list is enough; we put it under a generic
  // octet-stream MIME so the dialog shows the chosen extensions.
  return [{ description: 'Files', accept: { 'application/octet-stream': [...accept] } }];
}

async function pickFilesForOpen(req: FileOpenRequest): Promise<ReadonlyArray<FileHandle>> {
  if (typeof window.showOpenFilePicker !== 'function') {
    throw new Error('File System Access API is required to open files in the web app.');
  }
  let handles: FileSystemFileHandle[];
  try {
    handles = await window.showOpenFilePicker({
      multiple: req.multiple,
      types: acceptTypesFor(req.accept),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return [];
    throw err;
  }
  const out: FileHandle[] = [];
  for (const handle of handles) {
    out.push(fileHandleFromFile(handle, await handle.getFile()));
  }
  return out;
}

async function pickFileForSave(req: FileSaveRequest): Promise<SaveTarget | null> {
  if (typeof window.showSaveFilePicker !== 'function') {
    throw new Error('File System Access API is required to save files in the web app.');
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: req.suggestedName,
      types: acceptTypesFor(req.extensions),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
  return fileHandleTarget(handle);
}

async function reserveFileForSave(req: FileSaveRequest): Promise<SaveTarget | null> {
  const directory = await reserveSaveDirectory();
  if (directory === null) return null;
  const displayName =
    req.chooseName === undefined ? req.suggestedName : await req.chooseName(req.suggestedName);
  return displayName === null ? null : directory.file(displayName);
}

async function reserveSaveDirectory(): Promise<SaveDirectoryTarget | null> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw saveDirectoryUnsupportedError(
      'File System Access directory picker is required to save files safely.',
    );
  }
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
  return {
    file: (displayName) => directoryFileTarget(directory, displayName),
    exists: (displayName) => directoryHasEntry(directory, displayName),
  };
}

async function directoryHasEntry(
  directory: FileSystemDirectoryHandle,
  displayName: string,
): Promise<boolean> {
  try {
    await directory.getFileHandle(displayName);
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') return false;
    if (err instanceof Error && err.name === 'TypeMismatchError') return true;
    // Lost permission or I/O failure cannot prove a collision. Propagate it
    // rather than searching an unbounded sequence of names that all fail.
    throw err;
  }
}

function directoryFileTarget(
  directory: FileSystemDirectoryHandle,
  displayName: string,
): SaveTarget {
  const identity: WebSaveDestination = { kind: 'directory-file', directory, displayName };
  return {
    displayName,
    destinationIdentity: identity,
    isSameDestination: (other) => sameWebSaveDestination(identity, other.destinationIdentity),
    compareDestination: (other) => compareWebSaveDestination(identity, other.destinationIdentity),
    write: async (data) => {
      const handle = await directory.getFileHandle(displayName, { create: true });
      const writable = await handle.createWritable();
      await writeAndClose(writable, data);
    },
    writeChunks: async (chunks, signal, onFinalizing) => {
      signal?.throwIfAborted();
      const handle = await directory.getFileHandle(displayName, { create: true });
      await writeSaveChunks(await handle.createWritable(), chunks, signal, onFinalizing);
    },
  };
}

type WebSaveDestination =
  | { readonly kind: 'file'; readonly handle: FileSystemFileHandle }
  | {
      readonly kind: 'directory-file';
      readonly directory: FileSystemDirectoryHandle;
      readonly displayName: string;
    };

function fileHandleTarget(
  handle: FileSystemFileHandle,
  beforeWrite: () => Promise<void> = async () => undefined,
): SaveTarget {
  const identity: WebSaveDestination = { kind: 'file', handle };
  return {
    displayName: handle.name,
    recentRef: { kind: 'handle', handle },
    destinationIdentity: identity,
    isSameDestination: (other) => sameWebSaveDestination(identity, other.destinationIdentity),
    compareDestination: (other) => compareWebSaveDestination(identity, other.destinationIdentity),
    write: async (data) => {
      await beforeWrite();
      const writable = await handle.createWritable();
      await writeAndClose(writable, data);
    },
    writeChunks: async (chunks, signal, onFinalizing) => {
      signal?.throwIfAborted();
      await beforeWrite();
      await writeSaveChunks(await handle.createWritable(), chunks, signal, onFinalizing);
    },
  };
}

/** Save over a KerfDesk project opened from a handle (ADR-550). Open grants
 * only reading, so the first write asks to change the file, from the Save
 * click; Chromium shows its prompt in the browser, and the desktop app's
 * permission handler answers it. */
function openedProjectSaveTarget(ref: RecentFileRef): SaveTarget | null {
  if (ref.kind !== 'handle' || !/\.lf2$/i.test(ref.handle.name)) return null;
  return fileHandleTarget(ref.handle, () => requestWritePermission(ref.handle));
}

type WritePermissionHandle = {
  readonly queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  readonly requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
};

async function requestWritePermission(handle: FileSystemFileHandle): Promise<void> {
  const permissions = handle as unknown as WritePermissionHandle;
  // No permission model (older engines): the write reports any refusal itself.
  if (typeof permissions.queryPermission !== 'function') return;
  try {
    if ((await permissions.queryPermission({ mode: 'readwrite' })) === 'granted') return;
    if ((await permissions.requestPermission?.({ mode: 'readwrite' })) === 'granted') return;
  } catch {
    // A request without a user gesture throws; it is a refusal like any other.
  }
  throw new Error(`KerfDesk may not change ${handle.name}. Use Save As to save a copy.`);
}

async function sameWebSaveDestination(left: WebSaveDestination, right: unknown): Promise<boolean> {
  return (await compareWebSaveDestination(left, right)) === 'same';
}

async function compareWebSaveDestination(
  left: WebSaveDestination,
  right: unknown,
): Promise<SaveDestinationComparison> {
  if (!isWebSaveDestination(right) || left.kind !== right.kind) return 'unknown';
  if (left.kind === 'file' && right.kind === 'file') {
    return compareFileSystemEntry(left.handle, right.handle);
  }
  if (left.kind === 'directory-file' && right.kind === 'directory-file') {
    if (
      left.displayName === right.displayName &&
      (await compareFileSystemEntry(left.directory, right.directory)) === 'same'
    )
      return 'same';
    // Different directory/name pairs can still contain linked entries. Only
    // file-entry comparison proves those children distinct; do not guess.
  }
  return 'unknown';
}

function isWebSaveDestination(value: unknown): value is WebSaveDestination {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  if (value.kind === 'file') return 'handle' in value;
  return value.kind === 'directory-file' && 'directory' in value && 'displayName' in value;
}

async function compareFileSystemEntry(
  left: FileSystemHandle,
  right: FileSystemHandle,
): Promise<SaveDestinationComparison> {
  if (left === right) return 'same';
  if (typeof left.isSameEntry !== 'function') return 'unknown';
  const matches = await left.isSameEntry(right);
  return matches === true ? 'same' : matches === false ? 'different' : 'unknown';
}

async function writeAndClose(
  writable: FileSystemWritableFileStream,
  data: string | BufferSource | Blob,
): Promise<void> {
  let closed = false;
  try {
    await writable.write(data);
    await writable.close();
    closed = true;
  } catch (err) {
    if (!closed) await abortWritable(writable);
    throw err;
  }
}

async function abortWritable(writable: FileSystemWritableFileStream): Promise<void> {
  try {
    await writable.abort();
  } catch {
    // best-effort cleanup after write/close failure
  }
}

export const webAdapter: PlatformAdapter = {
  id: 'web',
  pickFilesForOpen,
  pickFileForSave,
  reserveFileForSave,
  reserveSaveDirectory,
  serial: webSerial,
  camera: webCamera,
  cameraBridge: createHttpCameraBridge(),
  recentFiles: webRecentFiles,
  externalFileOpens: createLaunchQueueFileOpens(),
  openedProjectSaveTarget,
};
