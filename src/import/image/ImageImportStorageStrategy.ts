export const IMAGE_INDEXEDDB_THRESHOLD = 100 * 1024; // 100KB

export type ImageImportStorageStrategy =
  | 'inline-data-uri'
  | 'indexeddb-data-uri'
  | 'indexeddb-blob';

export type ImageImportStorageInput =
  | { kind: 'file'; sizeBytes: number }
  | { kind: 'data-uri'; dataUriLength: number };

export function chooseImageImportStorageStrategy(
  input: ImageImportStorageInput,
): ImageImportStorageStrategy {
  if (input.kind === 'file') {
    return input.sizeBytes > IMAGE_INDEXEDDB_THRESHOLD
      ? 'indexeddb-blob'
      : 'inline-data-uri';
  }

  return input.dataUriLength > IMAGE_INDEXEDDB_THRESHOLD
    ? 'indexeddb-data-uri'
    : 'inline-data-uri';
}
