import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
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
});

describe('CutsLayersPanel numeric safety', () => {
  it('does not commit slow-burn minimums when visible numeric fields are blanked', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const operationId = requireOperationId();
    useStore.getState().setLayerParam(operationId, {
      mode: 'fill',
      speed: 1500,
      hatchSpacingMm: 0.2,
    });
    const { host, unmount } = await renderPanel();
    try {
      blankAndBlur(host, 'input[aria-label="Speed for selected objects"]');
      expect(useStore.getState().project.scene.layers[0]?.speed).toBe(1500);

      blankAndBlur(host, 'input[aria-label="Hatch spacing for selected objects"]');
      expect(useStore.getState().project.scene.layers[0]?.hatchSpacingMm).toBe(0.2);
    } finally {
      await unmount();
    }
  });

  it('does not commit maximum raster density when visible image density fields are blanked', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam(requireOperationId(), { mode: 'image', linesPerMm: 10 });
    const { host, unmount } = await renderPanel();
    try {
      blankAndBlur(host, 'input[aria-label="Line interval for selected objects"]');
      expect(useStore.getState().project.scene.layers[0]?.linesPerMm).toBe(10);

      blankAndBlur(host, 'input[aria-label="DPI for selected objects"]');
      expect(useStore.getState().project.scene.layers[0]?.linesPerMm).toBe(10);
    } finally {
      await unmount();
    }
  });
});

function requireOperationId(): string {
  const id = useStore.getState().project.scene.layers[0]?.id;
  if (id === undefined) throw new Error('operation missing');
  return id;
}

function blankAndBlur(host: HTMLElement, selector: string): void {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${selector} missing`);
  act(() => {
    input.value = '';
    Simulate.change(input);
  });
  act(() => {
    Simulate.blur(input);
  });
}
