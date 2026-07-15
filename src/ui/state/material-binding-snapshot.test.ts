import { beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const SOURCE_COLOR = '#ff0000';
const PRESET_ID = 'birch-refresh';

function targetLayer() {
  const layer = useStore.getState().project.scene.layers[0];
  if (layer === undefined) throw new Error('expected target layer');
  return layer;
}

function library(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'shop-library',
    name: 'Shop Library',
    entries: [
      {
        id: PRESET_ID,
        materialName: 'Birch plywood',
        description: 'Test preset',
        thicknessMm: 3,
        revision: 'rev-1',
        recipe: { ...captureMaterialRecipe(targetLayer()), power: 44 },
      },
    ],
  };
}

describe('linked material snapshots', () => {
  beforeEach(() => resetStore());

  it('does not nest the previous material binding when refreshed', () => {
    useStore.getState().importSvgObject(svgObj('O1', [SOURCE_COLOR]));
    useStore.getState().setMaterialLibrary(library());
    expect(useStore.getState().linkMaterialPresetToLayer(targetLayer().id, PRESET_ID)).toBe(true);
    expect(useStore.getState().refreshLinkedMaterialLayer(targetLayer().id)).toBe(true);

    expect(targetLayer().materialBinding?.lastResolved).not.toHaveProperty('materialBinding');
  });
});
