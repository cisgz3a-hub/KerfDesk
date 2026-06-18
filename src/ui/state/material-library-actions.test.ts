import { beforeEach, describe, expect, it } from 'vitest';
import { generateIntervalTestGrid, generateMaterialTestGrid } from '../../core/job';
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

describe('material library store actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('setMaterialLibrary loads a library without dirtying the project', () => {
    const doc = library();
    const projectBefore = useStore.getState().project;

    useStore.getState().setMaterialLibrary(doc);

    const state = useStore.getState();
    expect(state.materialLibrary).toEqual(doc);
    expect(state.materialLibraryDirty).toBe(false);
    expect(state.project).toBe(projectBefore);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
  });

  it('project resets preserve the loaded material library and library dirty state', () => {
    const doc = library([preset()]);
    const projectBefore = useStore.getState().project;
    useStore.getState().setMaterialLibrary(doc);
    useStore.setState({ materialLibraryDirty: true });

    useStore.getState().newProject();

    expect(useStore.getState().materialLibrary).toEqual(doc);
    expect(useStore.getState().materialLibraryDirty).toBe(true);

    useStore.getState().setProject(projectBefore);

    expect(useStore.getState().materialLibrary).toEqual(doc);
    expect(useStore.getState().materialLibraryDirty).toBe(true);
  });

  it('markMaterialLibrarySaved clears only the library dirty flag', () => {
    const doc = library([preset()]);
    useStore.getState().setMaterialLibrary(doc);
    useStore.setState({ dirty: false, materialLibraryDirty: true, undoStack: [], redoStack: [] });

    useStore.getState().markMaterialLibrarySaved();

    const state = useStore.getState();
    expect(state.materialLibrary).toEqual(doc);
    expect(state.materialLibraryDirty).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
  });

  it('createMaterialPresetFromLayer appends a captured preset and dirties only the library', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', {
      mode: 'fill',
      minPower: 8,
      power: 62,
      speed: 2350,
      passes: 3,
      visible: false,
      output: false,
      hatchAngleDeg: 33,
      fillBidirectional: false,
      fillCrossHatch: true,
      ditherAlgorithm: 'jarvis',
      linesPerMm: 14,
      negativeImage: true,
    });
    const expectedRecipe = captureMaterialRecipe(targetLayer());
    useStore.getState().setMaterialLibrary(library());
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    const created = useStore.getState().createMaterialPresetFromLayer('#ff0000', {
      id: 'birch-3mm-text',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Text engraving on 3 mm birch plywood',
      revision: 'rev-1',
    });

    const state = useStore.getState();
    expect(created).toMatchObject({
      id: 'birch-3mm-text',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Text engraving on 3 mm birch plywood',
      revision: 'rev-1',
      recipe: expectedRecipe,
    });
    expect(state.materialLibrary?.entries).toEqual([created]);
    expect(
      (created?.recipe as MaterialRecipe & { visible?: boolean; output?: boolean }).visible,
    ).toBeUndefined();
    expect(
      (created?.recipe as MaterialRecipe & { visible?: boolean; output?: boolean }).output,
    ).toBeUndefined();
    expect(state.materialLibraryDirty).toBe(true);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
  });

  it('creates a calibrated profile-matched recipe from a selected material test swatch', () => {
    const grid = generateMaterialTestGrid({
      rows: 1,
      columns: 2,
      speedMin: 1000,
      speedMax: 2000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 5,
    });
    useStore.getState().replaceSceneWithGeneratedScene(grid.scene);
    useStore.getState().selectObject('material-test-cell-r0-c0');
    useStore.getState().setMaterialLibrary(library());

    const created = useStore.getState().createMaterialPresetFromLayer('material-test-row-0', {
      id: 'birch-3mm-calibrated',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Clean fill',
      revision: 'manual-1',
    });

    expect(created).toMatchObject({
      confidence: 'calibrated',
      material: 'Birch plywood',
      operation: 'material-test',
      profileId: 'generic-grbl-400x400',
      machineFamily: 'generic-grbl-400x400',
      laserModel: 'GRBL 400x400',
      calibrationProvenance: 'Material Test swatch material-test-cell-r0-c0',
      description: expect.stringContaining('material-test-cell-r0-c0'),
      recipe: expect.objectContaining({ mode: 'fill', speed: 2000, power: 10 }),
    });
    expect(useStore.getState().materialLibraryDirty).toBe(true);
  });

  it('creates a calibrated interval recipe from a selected interval test swatch', () => {
    const grid = generateIntervalTestGrid({
      steps: 2,
      speed: 1500,
      power: 30,
      intervalMinMm: 0.08,
      intervalMaxMm: 0.2,
      swatchSizeMm: 8,
    });
    useStore.getState().replaceSceneWithGeneratedScene(grid.scene);
    useStore.getState().selectObject('interval-test-cell-1');
    useStore.getState().setMaterialLibrary(library());

    const created = useStore.getState().createMaterialPresetFromLayer('interval-test-step-1', {
      id: 'birch-interval-calibrated',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Clean interval',
      revision: 'manual-1',
    });

    expect(created).toMatchObject({
      confidence: 'calibrated',
      operation: 'interval-test',
      calibrationProvenance: 'Interval Test swatch interval-test-cell-1',
      description: expect.stringContaining('interval-test-cell-1'),
      recipe: expect.objectContaining({
        mode: 'fill',
        speed: 1500,
        power: 30,
        hatchSpacingMm: 0.08,
      }),
    });
  });

  it('createMaterialPresetFromLayer rejects invalid metadata and missing inputs', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(library([preset({ id: 'existing' })]));
    useStore.setState({ materialLibraryDirty: false });
    const before = useStore.getState().materialLibrary;

    expect(
      useStore.getState().createMaterialPresetFromLayer('#ff0000', {
        id: 'existing',
        materialName: 'Birch plywood',
        thicknessMm: 3,
        description: 'Duplicate id',
        revision: 'rev-1',
      }),
    ).toBeNull();
    expect(
      useStore.getState().createMaterialPresetFromLayer('#ff0000', {
        id: 'missing-label',
        materialName: 'Birch plywood',
        description: 'Neither thickness nor title',
        revision: 'rev-1',
      }),
    ).toBeNull();
    expect(
      useStore.getState().createMaterialPresetFromLayer('missing-layer', {
        id: 'missing-layer',
        materialName: 'Birch plywood',
        thicknessMm: 3,
        description: 'Missing layer',
        revision: 'rev-1',
      }),
    ).toBeNull();
    useStore.getState().setMaterialLibrary(null);
    expect(
      useStore.getState().createMaterialPresetFromLayer('#ff0000', {
        id: 'missing-library',
        materialName: 'Birch plywood',
        thicknessMm: 3,
        description: 'Missing library',
        revision: 'rev-1',
      }),
    ).toBeNull();
    expect(useStore.getState().materialLibraryDirty).toBe(false);

    useStore.getState().setMaterialLibrary(before);
    expect(useStore.getState().materialLibrary?.entries.map((entry) => entry.id)).toEqual([
      'existing',
    ]);
  });

  it('assignMaterialPresetToLayer applies a preset without linking the layer', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(library([preset()]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut')).toBe(
      true,
    );
    expect(captureMaterialRecipe(targetLayer())).toEqual(recipe());

    useStore.getState().setLayerParam('#ff0000', { power: 12 });

    expect(useStore.getState().materialLibrary?.entries[0]?.recipe.power).toBe(44);
  });

  it('assignMaterialPresetToLayer is project-undoable and keeps the library clean', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const originalRecipe = captureMaterialRecipe(targetLayer());
    useStore.getState().setMaterialLibrary(library([preset()]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut');

    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().materialLibraryDirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(captureMaterialRecipe(targetLayer())).toEqual(originalRecipe);
    expect(useStore.getState().materialLibraryDirty).toBe(false);
  });

  it('assignMaterialPresetToLayer preserves id, color, visible, and output', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { visible: false, output: false });
    useStore.getState().setMaterialLibrary(library([preset()]));

    useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut');

    expect(targetLayer()).toMatchObject({
      id: '#ff0000',
      color: '#ff0000',
      visible: false,
      output: false,
    });
  });

  it('assignMaterialPresetToLayer blocks recipes for incompatible device profiles', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const originalRecipe = captureMaterialRecipe(targetLayer());
    useStore.getState().setMaterialLibrary(
      library([
        preset({
          profileId: 'other-machine-profile',
          confidence: 'calibrated',
          recipe: recipe({ power: 99 }),
        }),
      ]),
    );
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut')).toBe(
      false,
    );
    expect(captureMaterialRecipe(targetLayer())).toEqual(originalRecipe);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('assignMaterialPresetToLayer blocks unsupported recipes', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const originalRecipe = captureMaterialRecipe(targetLayer());
    useStore.getState().setMaterialLibrary(
      library([
        preset({
          confidence: 'unsupported',
          warning: 'Clear acrylic is not supported on this diode profile.',
          recipe: recipe({ power: 99 }),
        }),
      ]),
    );
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut')).toBe(
      false,
    );
    expect(captureMaterialRecipe(targetLayer())).toEqual(originalRecipe);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('assignMaterialPresetToLayer no-ops for missing or identical recipes', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const matching = preset({ recipe: captureMaterialRecipe(targetLayer()) });
    useStore.getState().setMaterialLibrary(library([matching]));
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    expect(useStore.getState().assignMaterialPresetToLayer('#ff0000', 'missing-preset')).toBe(
      false,
    );
    expect(
      useStore.getState().assignMaterialPresetToLayer('missing-layer', 'birch-3mm-clean-cut'),
    ).toBe(false);
    expect(useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut')).toBe(
      false,
    );
    useStore.getState().setMaterialLibrary(null);
    expect(useStore.getState().assignMaterialPresetToLayer('#ff0000', 'birch-3mm-clean-cut')).toBe(
      false,
    );

    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
