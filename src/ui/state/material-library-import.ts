import { serializeMaterialLibrary, type MaterialLibraryDocument } from '../../io/material-library';
import {
  libraryDocument,
  uniqueLibraryId,
  type MaterialLibraryCollection,
} from './material-library-collection';

// Import adds a document; it never replaces a saved library. Reopening the same
// file reuses its identical document, including a previously renamed ID after a
// collision. Comparing canonical payloads includes every preset and revision.
export function resolveImportedLibrary(
  collection: MaterialLibraryCollection,
  incoming: MaterialLibraryDocument,
): MaterialLibraryDocument {
  // Bindings name an exact ID. A suffix is only a collision fallback, even if
  // its contents match and it appears before the original in storage order.
  if (!Object.hasOwn(collection.libraries, incoming.libraryId)) return incoming;
  const payload = serializeMaterialLibrary(incoming);
  const exact = libraryDocument(collection, incoming.libraryId);
  if (exact !== null && serializeMaterialLibrary(exact) === payload) return exact;
  for (const id of Object.keys(collection.libraries)) {
    if (!isImportCandidate(id, incoming.libraryId)) continue;
    const existing = libraryDocument(collection, id);
    if (
      existing !== null &&
      serializeMaterialLibrary({ ...existing, libraryId: incoming.libraryId }) === payload
    ) {
      return existing;
    }
  }
  const libraryId = uniqueLibraryId(incoming.libraryId, collection);
  return libraryId === incoming.libraryId ? incoming : { ...incoming, libraryId };
}

function isImportCandidate(id: string, originalId: string): boolean {
  const prefix = `${originalId}-`;
  if (!id.startsWith(prefix)) return false;
  const suffix = id.slice(prefix.length);
  const value = Number(suffix);
  return Number.isSafeInteger(value) && value >= 2 && String(value) === suffix;
}
