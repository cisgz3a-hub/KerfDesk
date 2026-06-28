// webAdapter — PlatformAdapter backed by the File System Access API.
//
// PROJECT.md "Delivery targets" requires Chromium (Chrome, Edge, Brave, Arc),
// all of which ship the File System Access API. No download-fallback path —
// if the user denies permission, WORKFLOW.md F-A11 says we re-prompt rather
// than silently save to IndexedDB.

import type {
  FileHandle,
  FileOpenRequest,
  FileSaveRequest,
  PlatformAdapter,
  SaveTarget,
} from '../types';
import { webCamera } from './web-camera';
import { webSerial } from './web-serial';

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
    out.push({ name: file.name, text: () => file.text() });
  }
  return out;
}

async function pickFileForSave(req: FileSaveRequest): Promise<SaveTarget | null> {
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
      await writable.write(data);
      await writable.close();
    },
  };
}

export const webAdapter: PlatformAdapter = {
  id: 'web',
  pickFilesForOpen,
  pickFileForSave,
  serial: webSerial,
  camera: webCamera,
};
