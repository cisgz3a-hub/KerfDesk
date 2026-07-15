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
  serial: {
    isSupported: () => false,
    requestPort: async () => null,
  },
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

describe('CutsLayersPanel layer order controls', () => {
  it('collapses to a narrow strip and expands from the same location', async () => {
    const { host, unmount } = await renderPanel();
    try {
      const collapse = host.querySelector('button[aria-label="Collapse Cuts / Layers panel"]');
      if (!(collapse instanceof HTMLButtonElement)) throw new Error('collapse button missing');

      await act(async () => collapse.click());
      expect(
        host.querySelector('aside[aria-label="Cuts / Layers panel collapsed"]'),
      ).not.toBeNull();

      const expand = host.querySelector('button[aria-label="Expand Cuts / Layers panel"]');
      if (!(expand instanceof HTMLButtonElement)) throw new Error('expand button missing');
      await act(async () => expand.click());

      expect(host.querySelector('aside[aria-label="Cuts / Layers panel"]')).not.toBeNull();
    } finally {
      await unmount();
    }
  });

  it('edits only selected artwork from the selected artwork settings', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.setState({ selectedObjectId: 'O2', additionalSelectedIds: new Set() });
    const { host, unmount } = await renderPanel();
    try {
      const mode = host.querySelector('select[aria-label="Mode for selected objects"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('layer mode missing');

      await act(async () => {
        mode.value = 'fill';
        Simulate.change(mode);
      });

      const state = useStore.getState();
      const layer = state.project.scene.layers.find((candidate) => candidate.id === '#000000');
      const first = state.project.scene.objects.find((object) => object.id === 'O1');
      const second = state.project.scene.objects.find((object) => object.id === 'O2');
      expect(layer?.mode).toBe('line');
      expect(first?.operationOverride).toBeUndefined();
      expect(second?.operationOverride).toMatchObject({ mode: 'fill' });
    } finally {
      await unmount();
    }
  });

  it('edits only selected artwork power from the selected artwork settings', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.setState({ selectedObjectId: 'O2', additionalSelectedIds: new Set() });
    const { host, unmount } = await renderPanel();
    try {
      const power = host.querySelector('input[aria-label="Power for selected objects"]');
      if (!(power instanceof HTMLInputElement)) throw new Error('layer power missing');

      act(() => {
        power.value = '55';
        Simulate.change(power);
      });
      act(() => {
        Simulate.blur(power);
      });

      const state = useStore.getState();
      const layer = state.project.scene.layers.find((candidate) => candidate.id === '#000000');
      const first = state.project.scene.objects.find((object) => object.id === 'O1');
      const second = state.project.scene.objects.find((object) => object.id === 'O2');
      expect(layer?.power).toBe(30);
      expect(first?.operationOverride).toBeUndefined();
      expect(second?.operationOverride).toMatchObject({ power: 55 });
    } finally {
      await unmount();
    }
  });

  it('edits all selected same-color artwork from the selected artwork settings', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });
    const { host, unmount } = await renderPanel();
    try {
      const mode = host.querySelector('select[aria-label="Mode for selected objects"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('layer mode missing');

      await act(async () => {
        mode.value = 'fill';
        Simulate.change(mode);
      });

      const state = useStore.getState();
      const layer = state.project.scene.layers.find((candidate) => candidate.id === '#000000');
      expect(layer?.mode).toBe('line');
      expect(state.project.scene.objects.map((object) => object.operationOverride)).toEqual([
        { mode: 'fill' },
        { mode: 'fill' },
      ]);
    } finally {
      await unmount();
    }
  });

  it('keeps selected-object layer cards compact to avoid duplicate settings panels', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().selectObject('O1');
    const { host, unmount } = await renderPanel();
    try {
      expect(host.textContent).toContain('Selected Artwork Settings');
      expect(host.textContent).toContain('Editing selected (1)');
      expect(host.querySelector('select[aria-label="Mode for selected objects"]')).not.toBeNull();
      expect(host.querySelector('select[aria-label="Mode for #000000"]')).toBeNull();
      expect(host.querySelector('input[aria-label="Power for #000000"]')).toBeNull();
      expect(host.textContent).toContain('Use Selected Artwork Settings above for this selection.');
    } finally {
      await unmount();
    }
  });

  it('keeps raster image adjustment controls inside the selected artwork inspector', async () => {
    useStore.getState().importRasterImage(rasterObj('R1'));
    const { host, unmount } = await renderPanel();
    try {
      const selectedPanel = host.querySelector('[aria-label="Selected object properties"]');
      if (!(selectedPanel instanceof HTMLElement)) throw new Error('selected panel missing');

      expect(
        selectedPanel.querySelector('[aria-label="Selected image adjustments"]'),
      ).not.toBeNull();
      expect(host.querySelectorAll('[aria-label="Selected image adjustments"]')).toHaveLength(1);

      const selectedPanelBottom = selectedPanel.getBoundingClientRect().bottom;
      const imageAdjustTop = (
        selectedPanel.querySelector('[aria-label="Selected image adjustments"]') as HTMLElement
      ).getBoundingClientRect().top;
      expect(imageAdjustTop).toBeGreaterThanOrEqual(
        selectedPanelBottom - selectedPanel.offsetHeight,
      );
    } finally {
      await unmount();
    }
  });

  it('moves a layer up through the Cuts / Layers panel', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff', '#00ff00']));
    const { host, unmount } = await renderPanel();
    try {
      const moveBlueUp = host.querySelector('button[aria-label="Move #0000ff up"]');
      if (!(moveBlueUp instanceof HTMLButtonElement)) throw new Error('move button missing');

      await act(async () => {
        moveBlueUp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual([
        '#0000ff',
        '#ff0000',
        '#00ff00',
      ]);
    } finally {
      await unmount();
    }
  });

  it('disables boundary layer move buttons', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    const { host, unmount } = await renderPanel();
    try {
      const topUp = host.querySelector('button[aria-label="Move #ff0000 up"]');
      const bottomDown = host.querySelector('button[aria-label="Move #0000ff down"]');
      if (!(topUp instanceof HTMLButtonElement)) throw new Error('top move button missing');
      if (!(bottomDown instanceof HTMLButtonElement)) throw new Error('bottom move button missing');

      expect(topUp.disabled).toBe(true);
      expect(bottomDown.disabled).toBe(true);
    } finally {
      await unmount();
    }
  });

  it('adds a manual layer and assigns the selected object to it', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const { host, unmount } = await renderPanel();
    try {
      const color = host.querySelector('input[aria-label="New layer color"]');
      const add = host.querySelector('button[aria-label="Add layer"]');
      if (!(color instanceof HTMLInputElement)) throw new Error('new layer color missing');
      if (!(add instanceof HTMLButtonElement)) throw new Error('add layer button missing');

      await act(async () => {
        color.value = '#00ff00';
        Simulate.change(color);
        add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
        '#ff0000',
        '#00ff00',
      ]);

      const assign = host.querySelector('button[aria-label="Assign selection to #00ff00"]');
      if (!(assign instanceof HTMLButtonElement)) throw new Error('assign button missing');
      await act(async () => {
        assign.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const obj = useStore.getState().project.scene.objects[0];
      expect(obj?.kind).toBe('imported-svg');
      if (obj?.kind !== 'imported-svg') throw new Error('expected imported svg');
      expect(obj.paths.map((path) => path.color)).toEqual(['#00ff00']);
    } finally {
      await unmount();
    }
  });

  it('selects all objects on a layer from the Cuts / Layers panel', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff', '#ff0000']));
    useStore.getState().importSvgObject(svgObj('O3', ['#0000ff']));
    const { host, unmount } = await renderPanel();
    try {
      const selectRed = host.querySelector('button[aria-label="Select all objects on #ff0000"]');
      if (!(selectRed instanceof HTMLButtonElement)) throw new Error('select layer button missing');

      await act(async () => {
        selectRed.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const state = useStore.getState();
      expect(state.selectedObjectId).toBe('O1');
      expect([...state.additionalSelectedIds]).toEqual(['O2']);
    } finally {
      await unmount();
    }
  });

  it('deletes a layer and its assigned artwork from the Cuts / Layers panel', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    const { host, unmount } = await renderPanel();
    try {
      const deleteRed = host.querySelector('button[aria-label="Delete layer #ff0000"]');
      if (!(deleteRed instanceof HTMLButtonElement)) throw new Error('delete layer button missing');

      await act(async () => {
        deleteRed.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['O2']);
      expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
        '#0000ff',
      ]);
    } finally {
      await unmount();
    }
  });

  it('copies and pastes layer settings from the Cuts / Layers panel', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    useStore.getState().setLayerParam('#ff0000', { power: 71, speed: 2345, passes: 4 });
    const { host, unmount } = await renderPanel();
    try {
      const copyRed = host.querySelector('button[aria-label="Copy settings from #ff0000"]');
      const pasteBlue = host.querySelector('button[aria-label="Paste settings to #0000ff"]');
      if (!(copyRed instanceof HTMLButtonElement)) throw new Error('copy button missing');
      if (!(pasteBlue instanceof HTMLButtonElement)) throw new Error('paste button missing');

      await act(async () => {
        copyRed.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        pasteBlue.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const blue = useStore.getState().project.scene.layers.find((layer) => layer.id === '#0000ff');
      expect(blue).toMatchObject({ color: '#0000ff', power: 71, speed: 2345, passes: 4 });
    } finally {
      await unmount();
    }
  });

  it('adds and edits a sub-layer operation from the Cuts / Layers panel', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const { host, unmount } = await renderPanel();
    try {
      const addSubLayer = host.querySelector('button[aria-label="Add sub-layer for #ff0000"]');
      if (!(addSubLayer instanceof HTMLButtonElement)) throw new Error('add sub-layer missing');

      await act(async () => {
        addSubLayer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const mode = host.querySelector('select[aria-label="Mode for Sub-layer 1 #ff0000"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('sub-layer mode missing');
      await act(async () => {
        mode.value = 'fill';
        Simulate.change(mode);
      });

      expect(useStore.getState().project.scene.layers[0]?.subLayers[0]).toMatchObject({
        id: 'sub-1',
        label: 'Sub-layer 1',
        enabled: true,
        settings: { mode: 'fill' },
      });
    } finally {
      await unmount();
    }
  });

  it('keeps sub-layer action controls inside a narrow layer card', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const { host, unmount } = await renderPanel();
    try {
      const addSubLayer = host.querySelector('button[aria-label="Add sub-layer for #ff0000"]');
      if (!(addSubLayer instanceof HTMLButtonElement)) throw new Error('add sub-layer missing');

      await act(async () => {
        addSubLayer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const deleteButton = host.querySelector(
        'button[aria-label="Delete Sub-layer 1 for #ff0000"]',
      );
      if (!(deleteButton instanceof HTMLButtonElement)) throw new Error('delete button missing');
      const row = deleteButton.parentElement;
      if (!(row instanceof HTMLDivElement)) throw new Error('sub-layer row missing');

      expect(row.style.display).toBe('flex');
      expect(row.style.flexWrap).toBe('wrap');
      expect(row.style.minWidth).toBe('0');
      expect(row.style.overflow).toBe('hidden');
    } finally {
      await unmount();
    }
  });

  it('keeps the Layers list visible when an object is selected [LAY-02]', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set() });
    const { host, unmount } = await renderPanel();
    try {
      const panel = host.querySelector('#cuts-layers-layers-panel');
      expect(panel).not.toBeNull();
      // The Layers page is the default and remains mounted while selected-object
      // settings are shown, so selection never hides the layer rows.
      expect(
        panel?.querySelector('button[aria-label="Select all objects on #ff0000"]'),
      ).not.toBeNull();
    } finally {
      await unmount();
    }
  });
});

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
