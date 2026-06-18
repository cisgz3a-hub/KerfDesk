import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
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

const NEOTRONICS_PROFILE_ID = 'neotronics-4040-max-lt4lds-v2-20w';

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
  it('updates a selected preset from the selected layer settings', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(
      library([
        preset({
          profileId: NEOTRONICS_PROFILE_ID,
          confidence: 'calibrated',
          calibrationProvenance: 'Material Test swatch material-test-cell-r0-c0',
        }),
      ]),
    );
    useStore.getState().setLayerParam('#ff0000', {
      power: 29,
      speed: 1850,
      hatchSpacingMm: 0.11,
    });
    const expectedRecipe = captureMaterialRecipe(useStore.getState().project.scene.layers[0]!);
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Update selected material preset from layer').click();
      });

      const entry = useStore.getState().materialLibrary?.entries[0];
      expect(entry).toMatchObject({
        id: 'birch-3mm-cut',
        profileId: NEOTRONICS_PROFILE_ID,
        confidence: 'calibrated',
        calibrationProvenance: 'Material Test swatch material-test-cell-r0-c0',
        recipe: expectedRecipe,
      });
      expect(useStore.getState().materialLibraryDirty).toBe(true);
      expect(host.textContent).toContain('Preset updated.');
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
