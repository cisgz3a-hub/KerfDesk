import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

function recipe(overrides: Partial<MaterialRecipe> = {}): MaterialRecipe {
  return {
    mode: 'fill',
    minPower: 5,
    power: 55,
    speed: 2200,
    passes: 2,
    airAssist: false,
    kerfOffsetMm: 0,
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

function library(entries: ReadonlyArray<MaterialPreset> = []): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'shop-library',
    name: 'Shop Library',
    entries,
  };
}

function file(name: string, text: string): FileHandle {
  return { name, text: async () => text };
}

function mockPlatform(
  args: {
    readonly open?: () => Promise<ReadonlyArray<FileHandle>>;
    readonly save?: () => Promise<SaveTarget | null>;
  } = {},
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: args.open ?? (async () => []),
    pickFileForSave: args.save ?? (async () => null),
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

async function renderPanel(
  platform: PlatformAdapter = mockPlatform(),
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <MaterialLibraryPanel />
      </PlatformProvider>,
    );
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
  it('shows new and load actions when no material library is loaded', async () => {
    const { host, root } = await renderPanel();
    try {
      expect(button(host, 'Create new material library')).toBeDefined();
      expect(button(host, 'Load material library')).toBeDefined();
    } finally {
      await unmount(root, host);
    }
  });

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

  it('creates a Neotronics starter material library from the researched 20W diode pack', async () => {
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Create Neotronics starter material library').click();
      });

      const state = useStore.getState();
      const ids = state.materialLibrary?.entries.map((entry) => entry.id) ?? [];
      expect(state.materialLibrary?.name).toContain('Neotronics 4040 Max');
      expect(ids).toContain('neotronics-lt4lds-wood-engrave-254dpi');
      expect(ids).toContain('neotronics-lt4lds-clear-acrylic-unsupported');
      expect(
        state.materialLibrary?.entries.find((entry) => entry.id.includes('clear-acrylic'))
          ?.description,
      ).toMatch(/not recommended/i);
      expect(state.materialLibraryDirty).toBe(false);
    } finally {
      await unmount(root, host);
    }
  });

  it('loads a material library through the panel file picker', async () => {
    const doc = library([preset()]);
    const { host, root } = await renderPanel(
      mockPlatform({
        open: async () => [file('shop.lfml.json', serializeMaterialLibrary(doc))],
      }),
    );
    try {
      await act(async () => {
        button(host, 'Load material library').click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(useStore.getState().materialLibrary).toEqual(doc);
      expect(useStore.getState().materialLibraryDirty).toBe(false);
    } finally {
      await unmount(root, host);
    }
  });

  it('shows loaded material library file actions', async () => {
    useStore.getState().setMaterialLibrary(library([preset()]));
    const { host, root } = await renderPanel();
    try {
      expect(button(host, 'Load material library')).toBeDefined();
      expect(button(host, 'Save material library')).toBeDefined();
      expect(button(host, 'Unload material library')).toBeDefined();
    } finally {
      await unmount(root, host);
    }
  });

  it('saves a material library through the panel and clears dirty state', async () => {
    const doc = library([preset()]);
    const writes: string[] = [];
    useStore.getState().setMaterialLibrary(doc);
    useStore.setState({ materialLibraryDirty: true });
    const { host, root } = await renderPanel(
      mockPlatform({
        save: async () => ({
          displayName: 'shop.lfml.json',
          write: async (text) => {
            writes.push(text);
          },
        }),
      }),
    );
    try {
      await act(async () => {
        button(host, 'Save material library').click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writes).toEqual([serializeMaterialLibrary(doc)]);
      expect(useStore.getState().materialLibraryDirty).toBe(false);
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
