// Resolves the Blob behind an import source, so the import worker can do the
// read itself instead of the main thread materializing the whole file first.
//
// Two shapes reach the import actions: drag-and-drop hands over real `File`
// objects (which ARE Blobs), while PlatformAdapter.pickFilesForOpen hands over
// FileHandle, whose `blob()` accessor is optional. Mocks and adapters that
// supply neither return null, and callers fall back to the synchronous
// text()-then-parse path.

export type BlobSourceFile = {
  readonly name: string;
  readonly size?: number;
  readonly text: () => Promise<string>;
  readonly blob?: () => Promise<Blob>;
};

export async function resolveImportBlob(file: BlobSourceFile): Promise<Blob | null> {
  if (typeof Blob !== 'undefined' && file instanceof Blob) return file;
  if (file.blob === undefined) return null;
  try {
    return await file.blob();
  } catch {
    return null;
  }
}

/** Byte size from the handle, else from the resolved Blob, else null. */
export function importByteSize(file: BlobSourceFile, blob: Blob | null): number | null {
  if (file.size !== undefined) return file.size;
  return blob === null ? null : blob.size;
}
