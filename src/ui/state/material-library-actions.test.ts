import { beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
import { primaryOperationForObject } from '../../core/scene';
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
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === 'O1');
  const operation = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error('expected artwork operation');
  return operation;
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

  it('assignMaterialPresetToLayer applies a preset without linking the layer', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(library([preset()]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    expect(
      useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut'),
    ).toBe(true);
    expect(captureMaterialRecipe(targetLayer())).toEqual(recipe());

    useStore.getState().setLayerParam(targetLayer().id, { power: 12 });

    expect(useStore.getState().materialLibrary?.entries[0]?.recipe.power).toBe(44);
  });

  it('applies a device-mismatched preset (warn, not block) per ADR-045 [LAY-01]', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const mismatched = preset({
      id: 'other-machine',
      profileId: 'a-different-machine',
      recipe: recipe({ power: 77 }),
    });
    useStore.getState().setMaterialLibrary(library([mismatched]));

    // Before LAY-01 this returned false ("Preset was not applied") because the
    // store re-blocked cross-machine reuse, contradicting ADR-045. (The
    // matched-but-'unsupported' safety block is covered separately below.)
    expect(useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'other-machine')).toBe(
      true,
    );
    expect(captureMaterialRecipe(targetLayer()).power).toBe(77);
  });

  it('assignMaterialPresetToLayer is project-undoable and keeps the library clean', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const originalRecipe = captureMaterialRecipe(targetLayer());
    useStore.getState().setMaterialLibrary(library([preset()]));
    useStore.setState({ dirty: false, materialLibraryDirty: false, undoStack: [], redoStack: [] });

    useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut');

    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().materialLibraryDirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(captureMaterialRecipe(targetLayer())).toEqual(originalRecipe);
    expect(useStore.getState().materialLibraryDirty).toBe(false);
  });

  it('assignMaterialPresetToLayer preserves id, color, visible, and output', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const identity = {
      id: targetLayer().id,
      color: targetLayer().color,
    };
    useStore.getState().setLayerParam(targetLayer().id, { visible: false, output: false });
    useStore.getState().setMaterialLibrary(library([preset()]));

    useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut');

    expect(targetLayer()).toMatchObject({
      ...identity,
      visible: false,
      output: false,
    });
  });

  it('links a layer with a last-resolved snapshot and refreshes from the active library', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(library([preset()]));
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    expect(
      useStore.getState().linkMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut'),
    ).toBe(true);
    expect(targetLayer().materialBinding).toMatchObject({
      libraryId: 'shop-library',
      presetId: 'birch-3mm-clean-cut',
      lastResolved: { power: 44 },
    });

    useStore.getState().setMaterialLibrary(null);
    expect(targetLayer().power).toBe(44);
    expect(targetLayer().materialBinding?.lastResolved.power).toBe(44);
    expect(useStore.getState().refreshLinkedMaterialLayer(targetLayer().id)).toBe(false);
  });

  // (The old "blocks recipes for incompatible device profiles" test was removed:
  // ADR-045 says device mismatch is warn-not-block, now asserted by the
  // device-mismatch apply test above. The 'unsupported' safety block below stays.)

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

    expect(
      useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut'),
    ).toBe(false);
    expect(captureMaterialRecipe(targetLayer())).toEqual(originalRecipe);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('assignMaterialPresetToLayer no-ops for missing or identical recipes', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const matching = preset({ recipe: captureMaterialRecipe(targetLayer()) });
    useStore.getState().setMaterialLibrary(library([matching]));
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    expect(
      useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'missing-preset'),
    ).toBe(false);
    expect(
      useStore.getState().assignMaterialPresetToLayer('missing-layer', 'birch-3mm-clean-cut'),
    ).toBe(false);
    expect(
      useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut'),
    ).toBe(false);
    useStore.getState().setMaterialLibrary(null);
    expect(
      useStore.getState().assignMaterialPresetToLayer(targetLayer().id, 'birch-3mm-clean-cut'),
    ).toBe(false);

    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
