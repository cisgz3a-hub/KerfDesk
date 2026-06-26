// Pure model for the in-app collection of material libraries (ADR-093).
//
// One library is "active" (edited live as `materialLibrary` in the store);
// every library — active included — is held here as its byte-identical
// `.lfml.json` payload so the whole set survives a reload. The active
// payload is allowed to lag the live document between edits; persistence and
// `summarizeLibraries` overlay the live document, and `reconcileActiveDocument`
// folds it back in, so no library is ever lost regardless of which action
// swapped the active document. No storage, clock, or React here — callers pass
// `now` in (CLAUDE.md pure-core posture, applied to this state helper too).

import {
  deserializeMaterialLibrary,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from '../../io/material-library';

export type StoredLibraryEntry = {
  readonly payload: string;
  readonly updatedAt: number;
};

export type MaterialLibraryCollection = {
  readonly activeLibraryId: string | null;
  readonly libraries: Readonly<Record<string, StoredLibraryEntry>>;
};

export type SavedLibrarySummary = {
  readonly id: string;
  readonly name: string;
  readonly deviceHintName: string | null;
  readonly presetCount: number;
  readonly updatedAt: number;
  readonly isActive: boolean;
};

export const EMPTY_MATERIAL_LIBRARY_COLLECTION: MaterialLibraryCollection = {
  activeLibraryId: null,
  libraries: {},
};

export function isEmptyCollection(collection: MaterialLibraryCollection): boolean {
  return Object.keys(collection.libraries).length === 0;
}

export function setLibraryPayload(
  collection: MaterialLibraryCollection,
  doc: MaterialLibraryDocument,
  now: number,
): MaterialLibraryCollection {
  return {
    activeLibraryId: collection.activeLibraryId,
    libraries: {
      ...collection.libraries,
      [doc.libraryId]: { payload: serializeMaterialLibrary(doc), updatedAt: now },
    },
  };
}

export function setActiveLibrary(
  collection: MaterialLibraryCollection,
  id: string | null,
): MaterialLibraryCollection {
  if (id !== null && collection.libraries[id] === undefined) return collection;
  return { activeLibraryId: id, libraries: collection.libraries };
}

export function removeLibrary(
  collection: MaterialLibraryCollection,
  id: string,
): MaterialLibraryCollection {
  if (collection.libraries[id] === undefined) return collection;
  const libraries: Record<string, StoredLibraryEntry> = {};
  for (const [key, entry] of Object.entries(collection.libraries)) {
    if (key !== id) libraries[key] = entry;
  }
  return {
    activeLibraryId: collection.activeLibraryId === id ? null : collection.activeLibraryId,
    libraries,
  };
}

export function libraryDocument(
  collection: MaterialLibraryCollection,
  id: string,
): MaterialLibraryDocument | null {
  const entry = collection.libraries[id];
  if (entry === undefined) return null;
  const result = deserializeMaterialLibrary(entry.payload);
  return result.kind === 'ok' ? result.library : null;
}

// Returns a free library id derived from `base` that does not collide with an
// existing entry (e.g. `birch`, then `birch-2`, `birch-3`...).
export function uniqueLibraryId(base: string, collection: MaterialLibraryCollection): string {
  const root = base.length === 0 ? 'library' : base;
  if (collection.libraries[root] === undefined) return root;
  let suffix = 2;
  while (collection.libraries[`${root}-${suffix}`] !== undefined) suffix += 1;
  return `${root}-${suffix}`;
}

// Fold the live active document into the collection and point activeLibraryId at
// it. The previous active library's payload is preserved, so swapping the active
// document (Load, New, a preset edit) never drops other libraries.
export function reconcileActiveDocument(
  collection: MaterialLibraryCollection,
  active: MaterialLibraryDocument | null,
  now: number,
): MaterialLibraryCollection {
  if (active === null) return setActiveLibrary(collection, null);
  return setActiveLibrary(setLibraryPayload(collection, active, now), active.libraryId);
}

export function collectionChanged(
  before: MaterialLibraryCollection,
  after: MaterialLibraryCollection,
): boolean {
  if (before === after) return false;
  if (before.activeLibraryId !== after.activeLibraryId) return true;
  const afterKeys = Object.keys(after.libraries);
  if (afterKeys.length !== Object.keys(before.libraries).length) return true;
  return afterKeys.some((key) => before.libraries[key]?.payload !== after.libraries[key]?.payload);
}

// Summaries for the Saved Libraries page. The active library is read from the
// live document so its name / preset count are current even if its stored
// payload lags; corrupt payloads are skipped rather than failing the list.
export function summarizeLibraries(
  collection: MaterialLibraryCollection,
  active: MaterialLibraryDocument | null,
): ReadonlyArray<SavedLibrarySummary> {
  return Object.entries(collection.libraries)
    .map(([id, entry]) => summaryFor(id, entry, collection.activeLibraryId, active))
    .filter((summary): summary is SavedLibrarySummary => summary !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function summaryFor(
  id: string,
  entry: StoredLibraryEntry,
  activeId: string | null,
  active: MaterialLibraryDocument | null,
): SavedLibrarySummary | null {
  const doc = id === activeId && active !== null ? active : documentOrNull(entry.payload);
  if (doc === null) return null;
  return {
    id,
    name: doc.name,
    deviceHintName: doc.deviceHint?.name ?? null,
    presetCount: doc.entries.length,
    updatedAt: entry.updatedAt,
    isActive: id === activeId,
  };
}

function documentOrNull(payload: string): MaterialLibraryDocument | null {
  const result = deserializeMaterialLibrary(payload);
  return result.kind === 'ok' ? result.library : null;
}

export function serializeCollection(collection: MaterialLibraryCollection): string {
  return JSON.stringify(collection);
}

// Validates the envelope shape only; per-payload validity is checked lazily on
// read (a single corrupt payload must not discard the whole collection).
export function parseCollection(raw: string): MaterialLibraryCollection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const activeLibraryId = parsed['activeLibraryId'];
  const libraries = parsed['libraries'];
  if (activeLibraryId !== null && typeof activeLibraryId !== 'string') return null;
  if (!isRecord(libraries)) return null;

  const entries: Record<string, StoredLibraryEntry> = {};
  for (const [key, value] of Object.entries(libraries)) {
    if (!isStoredEntry(value)) return null;
    entries[key] = { payload: value.payload, updatedAt: value.updatedAt };
  }
  const active =
    activeLibraryId !== null && entries[activeLibraryId] === undefined ? null : activeLibraryId;
  return { activeLibraryId: active, libraries: entries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredEntry(value: unknown): value is StoredLibraryEntry {
  return (
    isRecord(value) &&
    typeof value['payload'] === 'string' &&
    typeof value['updatedAt'] === 'number' &&
    Number.isFinite(value['updatedAt'])
  );
}
