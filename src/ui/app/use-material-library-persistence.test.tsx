// Two windows of the app share one localStorage. When one saves the material
// library collection, the browser sends 'storage' to the others; each must take
// the saved copy, so its next save cannot erase the first window's edits
// (audit D-4).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { MaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { useStore } from '../state';
import {
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  libraryDocument,
  serializeCollection,
  setActiveLibrary,
  setLibraryPayload,
  type MaterialLibraryCollection,
} from '../state/material-library-collection';
import {
  MATERIAL_LIBRARIES_STORAGE_KEY,
  restoreCollection,
} from '../state/material-library-persistence';
import { resetStore } from '../state/test-helpers';
import { useMaterialLibraryPersistence } from './use-material-library-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const recipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  kerfOffsetMm: 0,
  tabsEnabled: false,
  tabSizeMm: 0.5,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillStyle: 'scanline',
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'floyd-steinberg',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
  imageBidirectional: true,
  allowUncalibratedBidirectionalScan: false,
};

let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(async () => {
  if (root !== null) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  vi.restoreAllMocks();
  resetStore();
  localStorage.clear();
});

describe('material libraries with two app windows open', () => {
  it('keeps a preset another window saved when this window saves next', async () => {
    await openWindow(collection('birch', library('birch')));

    const writes = await saveInOtherWindow(
      collection('birch', library('birch', [preset('cut-3mm')])),
    );

    expect(presetIds(useStore.getState().materialLibrary)).toEqual(['cut-3mm']);
    expect(writes).not.toHaveBeenCalled();
    await act(async () => {
      useStore.getState().upsertMaterialPreset(preset('engrave-3mm'));
    });
    expect(storedPresetIds('birch')).toEqual(['cut-3mm', 'engrave-3mm']);
  });

  it('keeps its own open library while another window works in a different one', async () => {
    await openWindow(collection('birch', library('birch'), library('maple')));

    const writes = await saveInOtherWindow(
      collection('maple', library('birch'), library('maple', [preset('maple-cut')])),
    );

    expect(useStore.getState().materialLibrary?.libraryId).toBe('birch');
    expect(writes).not.toHaveBeenCalled();
    await act(async () => {
      useStore.getState().upsertMaterialPreset(preset('birch-cut'));
    });
    expect(storedPresetIds('birch')).toEqual(['birch-cut']);
    expect(storedPresetIds('maple')).toEqual(['maple-cut']);
  });

  it('keeps an open library that another window deleted instead of dropping it', async () => {
    await openWindow(collection('birch', library('birch', [preset('cut-3mm')]), library('maple')));

    const writes = await saveInOtherWindow(collection('maple', library('maple')));

    expect(presetIds(useStore.getState().materialLibrary)).toEqual(['cut-3mm']);
    expect(writes).not.toHaveBeenCalled();
  });
});

async function openWindow(stored: MaterialLibraryCollection): Promise<void> {
  localStorage.setItem(MATERIAL_LIBRARIES_STORAGE_KEY, serializeCollection(stored));
  function Host(): null {
    useMaterialLibraryPersistence();
    return null;
  }
  const current = createRoot(document.createElement('div'));
  root = current;
  await act(async () => current.render(<Host />));
}

// Another window writes the shared storage; the browser then sends 'storage'
// to this window. Returns a spy on the writes this window makes in response.
async function saveInOtherWindow(
  saved: MaterialLibraryCollection,
): Promise<MockInstance<Storage['setItem']>> {
  const raw = serializeCollection(saved);
  localStorage.setItem(MATERIAL_LIBRARIES_STORAGE_KEY, raw);
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: MATERIAL_LIBRARIES_STORAGE_KEY, newValue: raw }),
    );
  });
  return writes;
}

function collection(
  activeId: string,
  ...docs: ReadonlyArray<MaterialLibraryDocument>
): MaterialLibraryCollection {
  const withDocs = docs.reduce(
    (current, doc) => setLibraryPayload(current, doc, 1),
    EMPTY_MATERIAL_LIBRARY_COLLECTION,
  );
  return setActiveLibrary(withDocs, activeId);
}

function library(
  libraryId: string,
  entries: ReadonlyArray<MaterialPreset> = [],
): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId,
    name: libraryId,
    entries,
  };
}

function preset(id: string): MaterialPreset {
  return { id, materialName: 'Birch', thicknessMm: 3, description: id, recipe, revision: 'r1' };
}

function presetIds(doc: MaterialLibraryDocument | null): ReadonlyArray<string> | undefined {
  return doc?.entries.map((entry) => entry.id);
}

function storedPresetIds(libraryId: string): ReadonlyArray<string> | undefined {
  const stored = restoreCollection(localStorage);
  return presetIds(stored === null ? null : libraryDocument(stored, libraryId));
}
