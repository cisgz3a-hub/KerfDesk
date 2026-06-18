import { beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

function recipe(overrides: Partial<MaterialRecipe> = {}): MaterialRecipe {
  return {
    mode: 'fill',
    minPower: 4,
    power: 44,
    speed: 1900,
    passes: 2,
    airAssist: false,
    kerfOffsetMm: 0,
    tabsEnabled: false,
    tabSizeMm: 0.5,
    tabsPerShape: 4,
    tabSkipInnerShapes: true,
    hatchAngleDeg: 15,
    hatchSpacingMm: 0.08,
    fillOverscanMm: 3,
    fillStyle: 'scanline',
    fillBidirectional: false,
    fillCrossHatch: true,
    ditherAlgorithm: 'atkinson',
    linesPerMm: 12,
    negativeImage: true,
    passThrough: false,
    dotWidthCorrectionMm: 0.05,
    ...overrides,
  };
}

function preset(overrides: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'birch-3mm-clean-cut',
    materialName: 'Birch plywood',
    thicknessMm: 3,
    description: 'Clean cut on 3 mm birch plywood',
    recipe: recipe(),
    revision: 'rev-1',
    ...overrides,
  };
}

function library(entries: ReadonlyArray<MaterialPreset> = []): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'shop-library',
    name: 'Shop Library',
    entries,
  };
}

function targetLayer() {
  const layer = useStore
    .getState()
    .project.scene.layers.find((candidate) => candidate.id === '#ff0000');
  if (layer === undefined) throw new Error('expected red layer');
  return layer;
}

describe('material library management actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('updateMaterialPresetFromLayer refreshes a preset recipe without changing metadata', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const originalPreset = preset({
      confidence: 'calibrated',
      profileId: 'generic-grbl-400x400',
      calibrationProvenance: 'Material Test swatch material-test-cell-r0-c0',
    });
    useStore.getState().setMaterialLibrary(library([originalPreset]));
    useStore.getState().setLayerParam('#ff0000', {
      mode: 'fill',
      power: 31,
      speed: 1750,
      hatchSpacingMm: 0.12,
    });
    const expectedRecipe = captureMaterialRecipe(targetLayer());
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    expect(
      useStore.getState().updateMaterialPresetFromLayer('#ff0000', 'birch-3mm-clean-cut'),
    ).toBe(true);

    const state = useStore.getState();
    expect(state.materialLibrary?.entries).toHaveLength(1);
    expect(state.materialLibrary?.entries[0]).toEqual({
      ...originalPreset,
      recipe: expectedRecipe,
    });
    expect(state.materialLibraryDirty).toBe(true);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
  });

  it('updateMaterialPresetFromLayer no-ops for missing or identical recipes', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const matching = preset({ recipe: captureMaterialRecipe(targetLayer()) });
    useStore.getState().setMaterialLibrary(library([matching]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().updateMaterialPresetFromLayer('#ff0000', 'missing-preset')).toBe(
      false,
    );
    expect(
      useStore.getState().updateMaterialPresetFromLayer('missing-layer', 'birch-3mm-clean-cut'),
    ).toBe(false);
    expect(
      useStore.getState().updateMaterialPresetFromLayer('#ff0000', 'birch-3mm-clean-cut'),
    ).toBe(false);
    useStore.getState().setMaterialLibrary(null);
    expect(
      useStore.getState().updateMaterialPresetFromLayer('#ff0000', 'birch-3mm-clean-cut'),
    ).toBe(false);

    expect(useStore.getState().materialLibraryDirty).toBe(false);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('deleteMaterialPreset removes a preset and dirties only the library', () => {
    const first = preset({ id: 'birch-3mm-clean-cut' });
    const second = preset({ id: 'walnut-2mm-engrave', materialName: 'Walnut', thicknessMm: 2 });
    useStore.getState().setMaterialLibrary(library([first, second]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().deleteMaterialPreset('birch-3mm-clean-cut')).toBe(true);

    const state = useStore.getState();
    expect(state.materialLibrary?.entries).toEqual([second]);
    expect(state.materialLibraryDirty).toBe(true);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
  });

  it('deleteMaterialPreset no-ops for missing presets and missing libraries', () => {
    useStore.getState().setMaterialLibrary(library([preset()]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().deleteMaterialPreset('missing-preset')).toBe(false);
    expect(useStore.getState().materialLibrary?.entries).toHaveLength(1);
    expect(useStore.getState().materialLibraryDirty).toBe(false);

    useStore.getState().setMaterialLibrary(null);
    expect(useStore.getState().deleteMaterialPreset('birch-3mm-clean-cut')).toBe(false);
    expect(useStore.getState().materialLibraryDirty).toBe(false);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
