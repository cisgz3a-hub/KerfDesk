import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import { createLayer, type LayerMode } from '../../core/scene';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { JobMaterialControls } from './JobMaterialControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function preset(
  id: string,
  materialName: string,
  thicknessMm: number,
  mode: LayerMode,
): MaterialPreset {
  return {
    id,
    materialName,
    thicknessMm,
    description: id,
    recipe: captureMaterialRecipe({ ...createLayer({ id, color: '#000000', mode }), power: 77 }),
    revision: 'rev-1',
  };
}

const LIBRARY: MaterialLibraryDocument = {
  format: MATERIAL_LIBRARY_FORMAT,
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'shop',
  name: 'Shop',
  entries: [
    preset('birch-3', 'Birch plywood', 3, 'line'),
    preset('birch-6', 'Birch plywood', 6, 'line'),
    preset('acrylic-5', 'Acrylic', 5, 'line'),
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  resetStore();
  useStore.getState().setMaterialLibrary(LIBRARY);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<JobMaterialControls library={LIBRARY} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('JobMaterialControls (ADR-496)', () => {
  it('sets the job material, thickness and switch', async () => {
    expect(options('Job material')).toEqual(['', 'Acrylic', 'Birch plywood']);
    expect(host.querySelector('[aria-label="Job material thickness"]')).toBeNull();

    await choose('Job material', 'Birch plywood');
    expect(useStore.getState().project.jobSetup.laserMaterial).toEqual({
      name: 'Birch plywood',
      autoApplyRecipes: true,
    });
    expect(options('Job material thickness')).toEqual(['', '3', '6']);

    await choose('Job material thickness', '6');
    expect(useStore.getState().project.jobSetup.laserMaterial?.thicknessMm).toBe(6);

    const checkbox = host.querySelector('[aria-label="New operations take the best recipe"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('switch missing');
    await act(async () => checkbox.click());
    expect(useStore.getState().project.jobSetup.laserMaterial).toEqual({
      name: 'Birch plywood',
      thicknessMm: 6,
      autoApplyRecipes: false,
    });

    await choose('Job material', '');
    expect(useStore.getState().project.jobSetup.laserMaterial).toBeUndefined();
  });

  it('applies the best recipes to the operations already there and says what happened', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
    const green = useStore.getState().project.scene.layers.find((l) => l.id === 'operation-O2');
    if (green === undefined) throw new Error('second operation missing');
    useStore.getState().setLayerParam(green.id, { mode: 'fill' });
    await choose('Job material', 'Birch plywood');
    await choose('Job material thickness', '3');

    const button = [...host.querySelectorAll('button')].find(
      (element) => element.textContent === 'Apply to all operations',
    );
    if (button === undefined) throw new Error('button missing');
    await act(async () => button.click());

    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      `1 operation linked to their best recipe. No recipe for: ${green.name}; they keep their settings.`,
    );
  });
});

async function choose(label: string, value: string): Promise<void> {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

function options(label: string): ReadonlyArray<string> {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
  return [...element.options].map((option) => option.value);
}
