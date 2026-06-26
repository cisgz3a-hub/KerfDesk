// Store slice for the in-app collection of material libraries (ADR-093).
//
// The active library is still edited live as `materialLibrary`; this slice owns
// the surrounding collection (`savedLibraries`) and the create / open / rename /
// duplicate / delete transitions the Saved Libraries page drives. Library state
// is app-level (like the active library), so these actions never touch the
// project undo stack. The collection self-heals from the live active document in
// use-material-library-persistence, so actions only need to record their own
// change.

import type { DeviceProfile } from '../../core/devices';
import type { Project } from '../../core/scene';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import {
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  libraryDocument,
  removeLibrary,
  setActiveLibrary,
  setLibraryPayload,
  summarizeLibraries,
  uniqueLibraryId,
  type MaterialLibraryCollection,
  type SavedLibrarySummary,
} from './material-library-collection';

export const SAVED_LIBRARIES_STATE_DEFAULTS = {
  savedLibraries: EMPTY_MATERIAL_LIBRARY_COLLECTION,
} as const;

export type SavedLibrariesState = {
  readonly savedLibraries: MaterialLibraryCollection;
};

export function currentSavedLibrariesState(state: SavedLibrariesState): SavedLibrariesState {
  return { savedLibraries: state.savedLibraries };
}

export type SavedLibrariesActions = {
  readonly createLibrary: (name: string) => string | null;
  readonly openSavedLibrary: (id: string) => boolean;
  readonly renameLibrary: (id: string, name: string) => boolean;
  readonly duplicateLibrary: (id: string) => string | null;
  readonly deleteLibrary: (id: string) => boolean;
  readonly listSavedLibraries: () => ReadonlyArray<SavedLibrarySummary>;
};

type SavedLibrariesActionState = SavedLibrariesState & {
  readonly project: Project;
  readonly materialLibrary: MaterialLibraryDocument | null;
  readonly materialLibraryDirty: boolean;
};

type SavedLibrariesPatch = Partial<
  Pick<SavedLibrariesActionState, 'savedLibraries' | 'materialLibrary' | 'materialLibraryDirty'>
>;

type EmptyPatch = Record<string, never>;

type SavedLibrariesSet = (
  fn: (state: SavedLibrariesActionState) => SavedLibrariesPatch | EmptyPatch,
) => void;

type SavedLibrariesGet = () => SavedLibrariesActionState;

export function savedLibrariesActions(
  set: SavedLibrariesSet,
  get: SavedLibrariesGet,
): SavedLibrariesActions {
  return {
    createLibrary: (name) => createLibrary(set, get, name),
    openSavedLibrary: (id) => openSavedLibrary(set, get, id),
    renameLibrary: (id, name) => renameLibrary(set, get, id, name),
    duplicateLibrary: (id) => duplicateLibrary(set, get, id),
    deleteLibrary: (id) => deleteLibrary(set, get, id),
    listSavedLibraries: () => summarizeLibraries(get().savedLibraries, get().materialLibrary),
  };
}

function createLibrary(
  set: SavedLibrariesSet,
  get: SavedLibrariesGet,
  name: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const state = get();
  const newDoc = blankLibrary(trimmed, state.project.device, state.savedLibraries);
  set((s) => ({
    materialLibrary: newDoc,
    materialLibraryDirty: false,
    savedLibraries: setActiveLibrary(
      setLibraryPayload(s.savedLibraries, newDoc, Date.now()),
      newDoc.libraryId,
    ),
  }));
  return newDoc.libraryId;
}

function openSavedLibrary(set: SavedLibrariesSet, get: SavedLibrariesGet, id: string): boolean {
  const target = libraryDocument(get().savedLibraries, id);
  if (target === null) return false;
  set((s) => ({
    materialLibrary: target,
    materialLibraryDirty: false,
    savedLibraries: setActiveLibrary(s.savedLibraries, id),
  }));
  return true;
}

function renameLibrary(
  set: SavedLibrariesSet,
  get: SavedLibrariesGet,
  id: string,
  name: string,
): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  const state = get();
  const isActive = isActiveLibrary(state, id);
  const source = isActive ? state.materialLibrary : libraryDocument(state.savedLibraries, id);
  if (source === null || source.name === trimmed) return false;

  const renamed: MaterialLibraryDocument = { ...source, name: trimmed };
  set((s) => ({
    savedLibraries: setLibraryPayload(s.savedLibraries, renamed, Date.now()),
    ...(isActive ? { materialLibrary: renamed } : {}),
  }));
  return true;
}

function duplicateLibrary(
  set: SavedLibrariesSet,
  get: SavedLibrariesGet,
  id: string,
): string | null {
  const state = get();
  const source = isActiveLibrary(state, id)
    ? state.materialLibrary
    : libraryDocument(state.savedLibraries, id);
  if (source === null) return null;

  const newId = uniqueLibraryId(`${source.libraryId}-copy`, state.savedLibraries);
  // A duplicate joins the list but does not become active (LightBurn parity).
  const copy: MaterialLibraryDocument = {
    ...source,
    libraryId: newId,
    name: `${source.name} copy`,
  };
  set((s) => ({ savedLibraries: setLibraryPayload(s.savedLibraries, copy, Date.now()) }));
  return newId;
}

function deleteLibrary(set: SavedLibrariesSet, get: SavedLibrariesGet, id: string): boolean {
  const state = get();
  if (state.savedLibraries.libraries[id] === undefined) return false;
  const wasActive = state.savedLibraries.activeLibraryId === id;
  set((s) => ({
    savedLibraries: removeLibrary(s.savedLibraries, id),
    ...(wasActive ? { materialLibrary: null, materialLibraryDirty: false } : {}),
  }));
  return true;
}

function isActiveLibrary(state: SavedLibrariesActionState, id: string): boolean {
  return state.savedLibraries.activeLibraryId === id && state.materialLibrary?.libraryId === id;
}

function blankLibrary(
  name: string,
  device: DeviceProfile,
  collection: MaterialLibraryCollection,
): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: uniqueLibraryId(slug(name), collection),
    name,
    deviceHint: createMaterialLibraryDeviceHint(device),
    entries: [],
  };
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'library'
  );
}
