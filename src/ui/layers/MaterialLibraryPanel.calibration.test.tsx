import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateIntervalTestGrid, generateMaterialTestGrid } from '../../core/job';
import type { PlatformAdapter } from '../../platform/types';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
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

function library(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'shop-library',
    name: 'Shop Library',
    entries: [],
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

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return element;
}

async function setInputValue(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

describe('MaterialLibraryPanel calibration recipes', () => {
  it('creates a calibrated recipe from a selected material test swatch', async () => {
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
    const { host, root } = await renderPanel();
    try {
      expect(host.textContent).toContain('Material Test');
      expect(host.textContent).toContain('2000 mm/min');
      expect(host.textContent).toContain('10% power');

      await setInputValue(input(host, 'Material name'), 'Birch plywood');
      await setInputValue(input(host, 'Material thickness millimeters'), '3');
      await setInputValue(input(host, 'Preset description'), 'Clean fill');

      await act(async () => {
        button(host, 'Create calibrated recipe').click();
      });

      expect(useStore.getState().materialLibrary?.entries[0]).toMatchObject({
        confidence: 'calibrated',
        operation: 'material-test',
        calibrationProvenance: 'Material Test swatch material-test-cell-r0-c0',
        recipe: expect.objectContaining({ speed: 2000, power: 10 }),
      });
    } finally {
      await unmount(root, host);
    }
  });

  it('creates a calibrated recipe from a selected interval test swatch', async () => {
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
    const { host, root } = await renderPanel();
    try {
      expect(host.textContent).toContain('Interval Test');
      expect(host.textContent).toContain('0.08 mm interval');

      await setInputValue(input(host, 'Material name'), 'Birch plywood');
      await setInputValue(input(host, 'Material thickness millimeters'), '3');
      await setInputValue(input(host, 'Preset description'), 'Clean interval');

      await act(async () => {
        button(host, 'Create calibrated recipe').click();
      });

      expect(useStore.getState().materialLibrary?.entries[0]).toMatchObject({
        confidence: 'calibrated',
        operation: 'interval-test',
        calibrationProvenance: 'Interval Test swatch interval-test-cell-1',
        recipe: expect.objectContaining({ speed: 1500, power: 30, hatchSpacingMm: 0.08 }),
      });
    } finally {
      await unmount(root, host);
    }
  });
});
