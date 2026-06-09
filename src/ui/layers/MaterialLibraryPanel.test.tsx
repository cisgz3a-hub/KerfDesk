import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

function recipe(overrides: Partial<MaterialRecipe> = {}): MaterialRecipe {
  return {
    mode: 'fill',
    minPower: 5,
    power: 55,
    speed: 2200,
    passes: 2,
    hatchAngleDeg: 22,
    hatchSpacingMm: 0.09,
    fillOverscanMm: 2,
    fillBidirectional: false,
    fillCrossHatch: true,
    ditherAlgorithm: 'stucki',
    linesPerMm: 11,
    negativeImage: true,
    passThrough: false,
    dotWidthCorrectionMm: 0.04,
    ...overrides,
  };
}

function preset(overrides: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'birch-3mm-cut',
    materialName: 'Birch plywood',
    thicknessMm: 3,
    description: 'Clean cut',
    recipe: recipe(),
    revision: 'rev-1',
    ...overrides,
  };
}

function library(entries: ReadonlyArray<MaterialPreset>): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'shop-library',
    name: 'Shop Library',
    entries,
  };
}

async function renderPanel(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<MaterialLibraryPanel />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

async function unmount(root: Root, host: HTMLElement): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const element = host.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return element;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return element;
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`missing select: ${label}`);
  return element;
}

async function setInputValue(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function setSelectValue(element: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

describe('MaterialLibraryPanel', () => {
  it('creates a blank device-scoped material library from the panel', async () => {
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Create new material library').click();
      });

      const state = useStore.getState();
      expect(state.materialLibrary).toMatchObject({
        format: MATERIAL_LIBRARY_FORMAT,
        librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
        entries: [],
      });
      expect(state.materialLibrary?.deviceHint?.name).toBe(state.project.device.name);
      expect(state.materialLibraryDirty).toBe(false);
    } finally {
      await unmount(root, host);
    }
  });

  it('captures a preset from the selected layer form fields', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', {
      mode: 'fill',
      minPower: 7,
      power: 64,
      speed: 2400,
      passes: 3,
      fillBidirectional: false,
      fillCrossHatch: true,
    });
    const expectedRecipe = captureMaterialRecipe(useStore.getState().project.scene.layers[0]!);
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Create new material library').click();
      });
      await setInputValue(input(host, 'Material name'), 'Birch plywood');
      await setInputValue(input(host, 'Material thickness millimeters'), '3');
      await setInputValue(input(host, 'Preset description'), 'Text engraving');

      await act(async () => {
        button(host, 'Create preset from selected layer').click();
      });

      const entry = useStore.getState().materialLibrary?.entries[0];
      expect(entry).toMatchObject({
        materialName: 'Birch plywood',
        thicknessMm: 3,
        description: 'Text engraving',
        recipe: expectedRecipe,
      });
      expect(useStore.getState().materialLibraryDirty).toBe(true);
    } finally {
      await unmount(root, host);
    }
  });

  it('assigns a selected preset to the selected target layer', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    useStore.getState().setMaterialLibrary(library([preset()]));
    const { host, root } = await renderPanel();
    try {
      await setSelectValue(select(host, 'Material library target layer'), '#0000ff');
      await setSelectValue(select(host, 'Material library preset'), 'birch-3mm-cut');

      await act(async () => {
        button(host, 'Assign selected material preset').click();
      });

      const target = useStore
        .getState()
        .project.scene.layers.find((layer) => layer.id === '#0000ff');
      expect(target).toBeDefined();
      if (target === undefined) throw new Error('target layer missing');
      expect(captureMaterialRecipe(target)).toEqual(recipe());
    } finally {
      await unmount(root, host);
    }
  });

  it('does not link assigned presets to later layer edits', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(library([preset()]));
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Assign selected material preset').click();
      });

      await act(async () => {
        useStore.getState().setLayerParam('#ff0000', { power: 12 });
      });

      expect(useStore.getState().materialLibrary?.entries[0]?.recipe.power).toBe(55);
    } finally {
      await unmount(root, host);
    }
  });

  it('disables create and assign controls when required inputs are missing', async () => {
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Create new material library').click();
      });

      expect(button(host, 'Create preset from selected layer').disabled).toBe(true);
      expect(button(host, 'Assign selected material preset').disabled).toBe(true);
    } finally {
      await unmount(root, host);
    }
  });
});
