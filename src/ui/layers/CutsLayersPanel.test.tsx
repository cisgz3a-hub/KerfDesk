import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

function PanelUnderTest(): JSX.Element {
  return (
    <PlatformProvider adapter={mockPlatform}>
      <CutsLayersPanel />
    </PlatformProvider>
  );
}

async function renderPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PanelUnderTest />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  resetStore();
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setCutsLayersView('layers');
});

describe('Artwork Operations panel', () => {
  it('collapses and expands with the artwork-operation identity', async () => {
    const { host, unmount } = await renderPanel();
    try {
      const collapse = host.querySelector(
        'button[aria-label="Collapse Artwork / Operations panel"]',
      );
      if (!(collapse instanceof HTMLButtonElement)) throw new Error('collapse button missing');
      await act(async () => collapse.click());
      expect(
        host.querySelector('aside[aria-label="Artwork / Operations panel collapsed"]'),
      ).not.toBeNull();
      const expand = host.querySelector('button[aria-label="Expand Artwork / Operations panel"]');
      if (!(expand instanceof HTMLButtonElement)) throw new Error('expand button missing');
      await act(async () => expand.click());
      expect(host.querySelector('aside[aria-label="Artwork / Operations panel"]')).not.toBeNull();
    } finally {
      await unmount();
    }
  });

  it('shows independent automatic colors for same-colored artwork', async () => {
    importTwoBlackArtworks();
    const { host, unmount } = await renderPanel();
    try {
      expect(host.querySelector('[aria-label="Operation Johann"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Operation Box"]')).not.toBeNull();
      expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
        '#000000',
        '#2563eb',
      ]);
    } finally {
      await unmount();
    }
  });

  it('edits only the operation belonging to the clicked artwork', async () => {
    importTwoBlackArtworks();
    useStore.getState().selectObject('Johann');
    const { host, unmount } = await renderPanel();
    try {
      const mode = host.querySelector('select[aria-label="Mode for selected objects"]');
      const power = host.querySelector('input[aria-label="Power for selected objects"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('mode missing');
      if (!(power instanceof HTMLInputElement)) throw new Error('power missing');
      await act(async () => {
        mode.value = 'fill';
        Simulate.change(mode);
      });
      await act(async () => {
        power.value = '55';
        Simulate.change(power);
      });
      await act(async () => Simulate.blur(power));
      const layers = useStore.getState().project.scene.layers;
      expect(layers.find((layer) => layer.name === 'Johann')).toMatchObject({
        mode: 'fill',
        power: 55,
      });
      expect(layers.find((layer) => layer.name === 'Box')).toMatchObject({
        mode: 'line',
        power: 30,
      });
    } finally {
      await unmount();
    }
  });

  it('offers and applies one unified operation for a multi-selection', async () => {
    importTwoBlackArtworks();
    useStore.setState({ selectedObjectId: 'Johann', additionalSelectedIds: new Set(['Box']) });
    const { host, unmount } = await renderPanel();
    try {
      expect(host.querySelector('[aria-label="Multiple artwork operations"]')).not.toBeNull();
      const unify = buttonByText(host, 'Use one operation for selection');
      await act(async () => unify.click());
      const ids = useStore.getState().project.scene.objects.map((object) => object.operationIds);
      expect(ids[0]).toEqual(ids[1]);
      expect(host.querySelector('[aria-label="Selected artwork operation"]')).not.toBeNull();
    } finally {
      await unmount();
    }
  });

  it('makes one member of a shared operation unique', async () => {
    importTwoBlackArtworks();
    const sharedId = useStore.getState().project.scene.layers[0]!.id;
    useStore.setState({ selectedObjectId: 'Johann', additionalSelectedIds: new Set(['Box']) });
    useStore.getState().useOperationForSelection(sharedId);
    useStore.setState({ selectedObjectId: 'Box', additionalSelectedIds: new Set() });
    const { host, unmount } = await renderPanel();
    try {
      const unique = buttonByText(host, 'Make unique');
      await act(async () => unique.click());
      const ids = useStore.getState().project.scene.objects.map((object) => object.operationIds);
      expect(ids[0]).not.toEqual(ids[1]);
    } finally {
      await unmount();
    }
  });

  it('adds a second first-class operation without a Sub-layers box', async () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    const { host, unmount } = await renderPanel();
    try {
      await act(async () => buttonByText(host, 'Add operation').click());
      const state = useStore.getState();
      expect(state.project.scene.layers).toHaveLength(2);
      expect(state.project.scene.objects[0]?.operationIds).toHaveLength(2);
      expect(host.textContent).not.toContain('Sub-layers');
      expect(host.querySelectorAll('section[aria-label^="Operation "]')).toHaveLength(2);
    } finally {
      await unmount();
    }
  });

  it('keeps operation rows compact and moves output order', async () => {
    importTwoBlackArtworks();
    const { host, unmount } = await renderPanel();
    try {
      const boxRow = host.querySelector('[aria-label="Operation Box"]');
      expect(boxRow?.querySelector('input[aria-label^="Power for"]')).toBeNull();
      const moveUp = host.querySelector('button[aria-label="Move Box up"]');
      if (!(moveUp instanceof HTMLButtonElement)) throw new Error('move button missing');
      await act(async () => moveUp.click());
      expect(useStore.getState().project.scene.layers.map((layer) => layer.name)).toEqual([
        'Box',
        'Johann',
      ]);
    } finally {
      await unmount();
    }
  });

  it('selects all artwork intentionally sharing an operation', async () => {
    importTwoBlackArtworks();
    const sharedId = useStore.getState().project.scene.layers[0]!.id;
    useStore.setState({ selectedObjectId: 'Johann', additionalSelectedIds: new Set(['Box']) });
    useStore.getState().useOperationForSelection(sharedId);
    useStore.setState({ selectedObjectId: null, additionalSelectedIds: new Set() });
    const { host, unmount } = await renderPanel();
    try {
      const select = host.querySelector('button[aria-label="Select all artwork using Johann"]');
      if (!(select instanceof HTMLButtonElement)) throw new Error('select button missing');
      await act(async () => select.click());
      expect(useStore.getState().selectedObjectId).toBe('Johann');
      expect([...useStore.getState().additionalSelectedIds]).toEqual(['Box']);
    } finally {
      await unmount();
    }
  });

  it('uses the same selection inspector for CNC operation settings', async () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().setMachineKind('cnc');
    const { host, unmount } = await renderPanel();
    try {
      expect(host.querySelector('[aria-label="Selected artwork operation"]')).not.toBeNull();
      expect(host.querySelector('select[aria-label^="Cut type for"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Power for selected objects"]')).toBeNull();
    } finally {
      await unmount();
    }
  });

  it('keeps raster adjustments inside the selected artwork inspector', async () => {
    useStore.getState().importRasterImage(rasterObj('R1'));
    const { host, unmount } = await renderPanel();
    try {
      const selected = host.querySelector('[aria-label="Selected object properties"]');
      expect(selected?.querySelector('[aria-label="Selected image adjustments"]')).not.toBeNull();
      expect(host.querySelectorAll('[aria-label="Selected image adjustments"]')).toHaveLength(1);
    } finally {
      await unmount();
    }
  });
});

function importTwoBlackArtworks(): void {
  useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
  useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  return button;
}

function rasterObj(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 20,
    pixelHeight: 20,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}
