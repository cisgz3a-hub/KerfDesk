import { describe, expect, it } from 'vitest';
import type { MaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import {
  collectionChanged,
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  isEmptyCollection,
  libraryDocument,
  parseCollection,
  reconcileActiveDocument,
  removeLibrary,
  serializeCollection,
  setActiveLibrary,
  setLibraryPayload,
  summarizeLibraries,
  uniqueLibraryId,
  type MaterialLibraryCollection,
} from './material-library-collection';

const lineRecipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 35,
  speed: 1400,
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
  ditherAlgorithm: 'threshold',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

function preset(patch: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'preset-line-birch-3mm',
    materialName: 'Birch Ply',
    thicknessMm: 3,
    description: 'Line cut',
    recipe: lineRecipe,
    revision: 'rev-1',
    ...patch,
  };
}

function doc(patch: Partial<MaterialLibraryDocument> = {}): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'birch',
    name: 'Birch Library',
    entries: [],
    ...patch,
  };
}

function withOne(now = 100): MaterialLibraryCollection {
  return reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, doc(), now);
}

describe('material library collection', () => {
  it('starts empty', () => {
    expect(isEmptyCollection(EMPTY_MATERIAL_LIBRARY_COLLECTION)).toBe(true);
    expect(summarizeLibraries(EMPTY_MATERIAL_LIBRARY_COLLECTION, null)).toEqual([]);
  });

  it('setLibraryPayload stores the serialized payload without changing the active id', () => {
    const collection = setLibraryPayload(EMPTY_MATERIAL_LIBRARY_COLLECTION, doc(), 7);
    expect(collection.activeLibraryId).toBeNull();
    expect(collection.libraries['birch']?.payload).toBe(serializeMaterialLibrary(doc()));
    expect(collection.libraries['birch']?.updatedAt).toBe(7);
  });

  it('setActiveLibrary only accepts ids that exist', () => {
    const collection = withOne();
    expect(setActiveLibrary(collection, 'birch').activeLibraryId).toBe('birch');
    expect(setActiveLibrary(collection, 'missing')).toBe(collection);
    expect(setActiveLibrary(collection, null).activeLibraryId).toBeNull();
  });

  it('reconcileActiveDocument folds the live doc in and preserves other libraries', () => {
    const first = withOne(100);
    const second = reconcileActiveDocument(first, doc({ libraryId: 'oak', name: 'Oak' }), 200);
    expect(second.activeLibraryId).toBe('oak');
    expect(Object.keys(second.libraries).sort()).toEqual(['birch', 'oak']);
    // Unloading deactivates but keeps every library.
    const unloaded = reconcileActiveDocument(second, null, 300);
    expect(unloaded.activeLibraryId).toBeNull();
    expect(Object.keys(unloaded.libraries).sort()).toEqual(['birch', 'oak']);
  });

  it('libraryDocument round-trips a stored payload and returns null for corrupt/missing', () => {
    const collection = withOne();
    expect(libraryDocument(collection, 'birch')).toEqual(doc());
    expect(libraryDocument(collection, 'missing')).toBeNull();
    const corrupt: MaterialLibraryCollection = {
      activeLibraryId: null,
      libraries: { bad: { payload: '{"format":"nope"}', updatedAt: 1 } },
    };
    expect(libraryDocument(corrupt, 'bad')).toBeNull();
  });

  it('removeLibrary drops the entry and clears the active id when it was active', () => {
    const collection = withOne();
    const after = removeLibrary(collection, 'birch');
    expect(after.libraries['birch']).toBeUndefined();
    expect(after.activeLibraryId).toBeNull();
    expect(removeLibrary(collection, 'missing')).toBe(collection);
  });

  it('uniqueLibraryId avoids collisions', () => {
    const collection = withOne();
    expect(uniqueLibraryId('oak', collection)).toBe('oak');
    expect(uniqueLibraryId('birch', collection)).toBe('birch-2');
    expect(uniqueLibraryId('', EMPTY_MATERIAL_LIBRARY_COLLECTION)).toBe('library');
  });

  it('collectionChanged detects active, key, and payload changes', () => {
    const collection = withOne();
    expect(collectionChanged(collection, collection)).toBe(false);
    expect(collectionChanged(collection, setActiveLibrary(collection, null))).toBe(true);
    expect(collectionChanged(collection, removeLibrary(collection, 'birch'))).toBe(true);
    const edited = setLibraryPayload(collection, doc({ name: 'Renamed' }), 999);
    expect(collectionChanged(collection, edited)).toBe(true);
  });

  it('summarizeLibraries overlays the live active doc, sorts newest first, skips corrupt', () => {
    const base = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, doc(), 100);
    const withOak = reconcileActiveDocument(base, doc({ libraryId: 'oak', name: 'Oak' }), 200);
    const withCorrupt: MaterialLibraryCollection = {
      activeLibraryId: 'oak',
      libraries: { ...withOak.libraries, bad: { payload: '{bad', updatedAt: 300 } },
    };
    // Live active doc (oak) carries an extra preset not yet in the stored payload.
    const liveOak = doc({ libraryId: 'oak', name: 'Oak', entries: [preset()] });

    const summaries = summarizeLibraries(withCorrupt, liveOak);

    expect(summaries.map((s) => s.id)).toEqual(['oak', 'birch']); // 200 before 100; bad skipped
    const oak = summaries[0];
    expect(oak?.isActive).toBe(true);
    expect(oak?.presetCount).toBe(1); // from the live doc, not the empty stored payload
    expect(summaries[1]?.isActive).toBe(false);
  });

  it('serializeCollection / parseCollection round-trip and reject bad envelopes', () => {
    const collection = withOne();
    expect(parseCollection(serializeCollection(collection))).toEqual(collection);
    expect(parseCollection('{not json')).toBeNull();
    expect(parseCollection(JSON.stringify({ libraries: 'nope' }))).toBeNull();
    expect(parseCollection(JSON.stringify({ activeLibraryId: 1, libraries: {} }))).toBeNull();
  });

  it('parseCollection drops an active id that points at a missing library', () => {
    const parsed = parseCollection(JSON.stringify({ activeLibraryId: 'ghost', libraries: {} }));
    expect(parsed).toEqual(EMPTY_MATERIAL_LIBRARY_COLLECTION);
  });
});
