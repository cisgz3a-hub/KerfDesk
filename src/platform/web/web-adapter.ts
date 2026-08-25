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
  SaveDirectoryTarget,
  SaveTarget,
} from '../types';
import { webCamera } from './web-camera';
import { webSerial } from './web-serial';
import { createHttpCameraBridge } from './camera-bridge';

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
    const file = await handle.getFile();
    out.push({ name: file.name, size: file.size, text: () => file.text(), blob: async () => file });
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
  return {
    displayName: handle.name,
    write: async (data) => {
      const writable = await handle.createWritable();
      await writeAndClose(writable, data);
    },
  };
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
    throw new Error('File System Access directory picker is required to save files safely.');
  }
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
  return { file: (displayName) => directoryFileTarget(directory, displayName) };
}

function directoryFileTarget(
  directory: FileSystemDirectoryHandle,
  displayName: string,
): SaveTarget {
  return {
    displayName,
    write: async (data) => {
      const handle = await directory.getFileHandle(displayName, { create: true });
      const writable = await handle.createWritable();
      await writeAndClose(writable, data);
    },
  };
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
};
