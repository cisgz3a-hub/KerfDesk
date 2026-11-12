// ADR-093 Amendment 2 (Oracle audit O9-P2-1): Apply turns off a scan pattern
// the preset does not hold, and an operation still holding one does not read as
// already matching the preset.
import { beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import { createLayer, primaryOperationForObject, type Layer } from '../../core/scene';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialPreset,
} from '../../io/material-library';
import { materialRecipeDifferences } from '../material-library/MaterialRecipePreview';
import { recipeMatchesLayer } from './material-library-actions';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const PRESET: MaterialPreset = {
  id: 'slate-photo',
  materialName: 'Slate',
  title: 'Photo',
  description: 'Photo on slate',
  recipe: captureMaterialRecipe({
    ...createLayer({ id: 'source', color: '#000000' }),
    mode: 'image',
    power: 40,
    speed: 6000,
  }),
  revision: '1',
};

function operation(): Layer {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === 'O1');
  const found = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (found === null) throw new Error('expected artwork operation');
  return found;
}

function replaceOperation(next: Layer): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => (layer.id === next.id ? next : layer)),
      },
    },
  });
}

describe('Apply preset and the scan pattern (ADR-093 Amendment 2)', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary({
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId: 'shop',
      name: 'Shop',
      entries: [PRESET],
    });
  });

  it('applies over a cross-hatched operation that otherwise matches, and turns the cross-hatch off', () => {
    // The operation holds the preset's settings, plus a cross-hatch from earlier work.
    const crossed: Layer = {
      ...operation(),
      ...PRESET.recipe,
      imageCrossHatch: true,
    };
    replaceOperation(crossed);
    expect(recipeMatchesLayer(crossed, PRESET.recipe)).toBe(false);
    expect(materialRecipeDifferences(crossed, PRESET)).toContainEqual({
      setting: 'Image cross-hatch',
      before: 'On',
      after: 'Off',
    });

    expect(useStore.getState().assignMaterialPresetToLayer(crossed.id, PRESET.id)).toBe(true);
    expect(operation().imageCrossHatch).toBeUndefined();
  });
});
