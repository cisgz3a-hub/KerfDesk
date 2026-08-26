import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialRecipe } from '../../core/material-library';
import type { PlatformAdapter } from '../../platform/types';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
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
    tabsEnabled: false,
    tabSizeMm: 0.5,
    tabsPerShape: 4,
    tabSkipInnerShapes: true,
    hatchAngleDeg: 22,
    hatchSpacingMm: 0.09,
    fillOverscanMm: 2,
    fillStyle: 'scanline',
    fillBidirectional: false,
    allowUncalibratedBidirectionalScan: false,
    fillCrossHatch: true,
    ditherAlgorithm: 'stucki',
    linesPerMm: 11,
    imageBidirectional: true,
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

function mockPlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

async function renderPanel(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
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

describe('MaterialLibraryPanel preset management', () => {
  it('surfaces stale linked revision truth and refreshes it explicitly', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(library([preset({ revision: 'rev-1' })]));
    const layerId = useStore.getState().project.scene.layers[0]?.id;
    if (layerId === undefined) throw new Error('target layer missing');
    expect(useStore.getState().linkMaterialPresetToLayer(layerId, 'birch-3mm-cut')).toBe(true);
    useStore
      .getState()
      .setMaterialLibrary(library([preset({ revision: 'rev-2', recipe: recipe({ power: 77 }) })]));

    const { host, root } = await renderPanel();
    try {
      expect(host.textContent).toContain('Linked preset is stale');
      expect(host.textContent).toContain('revision rev-1');
      expect(host.textContent).toContain('revision rev-2');
      const refresh = button(host, 'Refresh linked material preset');
      expect(refresh.disabled).toBe(false);

      await act(async () => refresh.click());

      const layer = useStore.getState().project.scene.layers[0];
      expect(layer?.power).toBe(77);
      expect(layer?.materialBinding?.presetRevision).toBe('rev-2');
      expect(host.textContent).toContain('Linked preset is current at revision rev-2');
    } finally {
      await unmount(root, host);
    }
  });

  it('deletes a selected material preset after confirmation', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore
      .getState()
      .setMaterialLibrary(
        library([
          preset({ id: 'birch-3mm-cut' }),
          preset({ id: 'walnut-2mm-engrave', materialName: 'Walnut', thicknessMm: 2 }),
        ]),
      );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Delete selected material preset').click();
      });

      expect(useStore.getState().materialLibrary?.entries.map((entry) => entry.id)).toEqual([
        'walnut-2mm-engrave',
      ]);
      expect(useStore.getState().materialLibraryDirty).toBe(true);
      expect(confirm).toHaveBeenCalledWith('Delete preset "Birch plywood - 3 mm"?');
      expect(host.textContent).toContain('Preset deleted.');
    } finally {
      await unmount(root, host);
    }
  });

  it('keeps a selected material preset when delete confirmation is cancelled', async () => {
    useStore.getState().setMaterialLibrary(library([preset({ id: 'birch-3mm-cut' })]));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Delete selected material preset').click();
      });

      expect(useStore.getState().materialLibrary?.entries).toHaveLength(1);
      expect(useStore.getState().materialLibraryDirty).toBe(false);
      expect(host.textContent).toContain('Delete cancelled.');
    } finally {
      await unmount(root, host);
    }
  });
});
