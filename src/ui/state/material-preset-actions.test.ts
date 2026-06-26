import { beforeEach, describe, expect, it } from 'vitest';
import type { MaterialRecipe } from '../../core/material-library';
import type { MaterialPreset } from '../../io/material-library';
import { useStore } from './store';
import { resetStore } from './test-helpers';

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
};

function preset(overrides: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'birch-3mm',
    materialName: 'Birch',
    thicknessMm: 3,
    description: 'Cut',
    recipe,
    revision: 'manual-1',
    ...overrides,
  };
}

describe('upsertMaterialPreset', () => {
  beforeEach(() => {
    resetStore();
  });

  it('adds a new preset to the active library and dirties only the library', () => {
    useStore.getState().createLibrary('Shop');
    useStore.setState({ materialLibraryDirty: false });

    expect(useStore.getState().upsertMaterialPreset(preset())).toBe(true);

    const state = useStore.getState();
    expect(state.materialLibrary?.entries).toHaveLength(1);
    expect(state.materialLibrary?.entries[0]?.materialName).toBe('Birch');
    expect(state.materialLibraryDirty).toBe(true);
    expect(state.dirty).toBe(false);
  });

  it('replaces an existing preset by id', () => {
    useStore.getState().createLibrary('Shop');
    useStore.getState().upsertMaterialPreset(preset());

    expect(
      useStore
        .getState()
        .upsertMaterialPreset(
          preset({ description: 'Deeper cut', recipe: { ...recipe, power: 70 } }),
        ),
    ).toBe(true);

    const entries = useStore.getState().materialLibrary?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.description).toBe('Deeper cut');
    expect(entries[0]?.recipe.power).toBe(70);
  });

  it('no-ops when no library is active', () => {
    expect(useStore.getState().materialLibrary).toBeNull();
    expect(useStore.getState().upsertMaterialPreset(preset())).toBe(false);
  });
});
