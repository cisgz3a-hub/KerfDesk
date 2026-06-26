import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
} from '../../io/material-library';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  button,
  file,
  input,
  library,
  mockPlatform,
  preset,
  recipe,
  renderPanel,
  select,
  setInputValue,
  setSelectValue,
  unmount,
} from './material-library-panel-test-helpers';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NEOTRONICS_PROFILE_ID = 'neotronics-4040-max-lt4lds-v2-20w';

afterEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

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

  it('hides the starter button when the device has no catalogued starter presets', async () => {
    // Default device is not in the starter catalog, so the device-driven button
    // is absent -- only New Library + Load remain.
    const { host, root } = await renderPanel();
    try {
      expect(
        host.querySelector(
          'button[aria-label="Create starter material library for the selected device"]',
        ),
      ).toBeNull();
      expect(button(host, 'Create new material library')).toBeDefined();
    } finally {
      await unmount(root, host);
    }
  });

  it('creates a starter library for the selected machine from its researched pack', async () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const { host, root } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Create starter material library for the selected device').click();
      });

      const state = useStore.getState();
      const ids = state.materialLibrary?.entries.map((entry) => entry.id) ?? [];
      expect(state.materialLibrary?.name).toContain('Neotronics 4040 Max');
      expect(ids).toContain('neotronics-lt4lds-wood-engrave-254dpi');
      expect(ids).toContain('neotronics-lt4lds-clear-acrylic-unsupported');
      expect(
        state.materialLibrary?.entries.find(
          (entry) => entry.id === 'neotronics-lt4lds-wood-engrave-254dpi',
        ),
      ).toMatchObject({
        profileId: 'neotronics-4040-max-lt4lds-v2-20w',
        machineFamily: 'neotronics-4040-max',
        opticalPowerW: 20,
        confidence: 'starter',
      });
      expect(
        state.materialLibrary?.entries.find((entry) => entry.id.includes('clear-acrylic')),
      ).toMatchObject({
        confidence: 'unsupported',
      });
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
          write: async (data) => {
            if (typeof data !== 'string') throw new Error('expected text material library');
            writes.push(data);
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

  it('prefers the best active-machine recipe match in the preset selector', async () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(
      library([
        preset({ id: 'generic-birch', confidence: 'starter' }),
        preset({
          id: 'neotronics-birch',
          profileId: NEOTRONICS_PROFILE_ID,
          confidence: 'calibrated',
          recipe: recipe({ power: 28 }),
        }),
      ]),
    );
    const { host, root } = await renderPanel();
    try {
      const presetSelect = select(host, 'Material library preset');

      expect(presetSelect.value).toBe('neotronics-birch');
      expect(presetSelect.options[0]?.textContent).toContain('calibrated / profile');
      expect(host.textContent).toContain('Preset Match');
      expect(host.textContent).toContain('calibrated / profile');
    } finally {
      await unmount(root, host);
    }
  });

  it('blocks unsupported recipe assignment and surfaces the recipe warning', async () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary(
      library([
        preset({
          id: 'clear-acrylic',
          materialName: 'Clear acrylic',
          profileId: NEOTRONICS_PROFILE_ID,
          confidence: 'unsupported',
          warning: 'Clear acrylic is not supported on this diode profile.',
        }),
      ]),
    );
    const { host, root } = await renderPanel();
    try {
      expect(host.textContent).toContain('Unsupported recipe.');
      expect(host.textContent).toContain('Clear acrylic is not supported');
      expect(button(host, 'Assign selected material preset').disabled).toBe(true);
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
