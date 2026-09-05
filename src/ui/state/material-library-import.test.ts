import { describe, expect, it } from 'vitest';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import {
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  libraryDocument,
  reconcileActiveDocument,
  removeLibrary,
} from './material-library-collection';
import { resolveImportedLibrary } from './material-library-import';

const original: MaterialLibraryDocument = {
  format: MATERIAL_LIBRARY_FORMAT,
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'birch',
  name: 'Calibrated library',
  entries: [],
};

describe('material library import identity', () => {
  it('preserves the existing document and reuses an identical collision copy on repeat import', () => {
    const collection = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, original, 1);
    const incoming = { ...original, name: 'Shared library' };
    const copy = resolveImportedLibrary(collection, incoming);
    expect(copy.libraryId).toBe('birch-2');
    const imported = reconcileActiveDocument(collection, copy, 2);
    expect(libraryDocument(imported, original.libraryId)).toEqual(original);
    expect(resolveImportedLibrary(imported, incoming)).toEqual(copy);
    expect(resolveImportedLibrary(imported, original)).toEqual(original);
  });

  it('finds a previous copy even when an earlier suffix was deleted', () => {
    let collection = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, original, 1);
    collection = reconcileActiveDocument(collection, { ...original, libraryId: 'birch-2' }, 2);
    const incoming = { ...original, name: 'Shared library' };
    const copy = resolveImportedLibrary(collection, incoming);
    expect(copy.libraryId).toBe('birch-3');
    collection = reconcileActiveDocument(collection, copy, 3);
    collection = removeLibrary(collection, 'birch-2');
    expect(resolveImportedLibrary(collection, incoming)).toEqual(copy);
  });

  it('retains unrelated library identities even when their contents happen to match', () => {
    const collection = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, original, 1);
    const incoming = { ...original, libraryId: 'separate' };
    expect(resolveImportedLibrary(collection, incoming)).toEqual(incoming);
  });

  it.each(['__proto__', 'constructor', 'toString'])('imports special ID %s without loss', (id) => {
    const incoming = { ...original, libraryId: id };
    const copy = resolveImportedLibrary(EMPTY_MATERIAL_LIBRARY_COLLECTION, incoming);
    expect(copy.libraryId).toBe(id);
    const saved = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, copy, 1);
    expect(resolveImportedLibrary(saved, incoming)).toEqual(copy);
  });
});
