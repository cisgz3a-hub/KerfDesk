import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as VectorToBitmap from '../raster/vector-to-bitmap';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { CommandShell, type AppCommand } from '../commands';

const bitmapMocks = vi.hoisted(() => ({
  buildBitmapFromVector: vi.fn(),
}));

vi.mock('../raster/vector-to-bitmap', async (importOriginal) => {
  const actual = await importOriginal<typeof VectorToBitmap>();
  return {
    ...actual,
    buildBitmapFromVector: bitmapMocks.buildBitmapFromVector,
  };
});

import { Toolbar } from './Toolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: {
    isSupported: () => false,
    requestPort: vi.fn(async () => null),
  },
};

function installVectorProject(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        layers: [
          createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
          createLayer({ id: '#0000ff', color: '#0000ff', mode: 'fill' }),
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'vec-1',
            source: 'logo.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 0, y: 5 },
                      { x: 10, y: 5 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    selectedObjectId: 'vec-1',
  });
}

function convertedRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'bmp-1',
    source: 'logo.svg (bitmap)',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 5,
  };
}

afterEach(() => {
  useStore.getState().newProject();
  useToastStore.setState({ toasts: [] });
  bitmapMocks.buildBitmapFromVector.mockReset();
  vi.restoreAllMocks();
});

describe('Toolbar Convert to Bitmap', () => {
  it('opens the LightBurn-style options dialog and passes Render Type plus DPI', async () => {
    installVectorProject();
    bitmapMocks.buildBitmapFromVector.mockResolvedValue(convertedRaster());
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <CommandShell />
          </PlatformProvider>,
        );
      });

      const openButton = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Convert to Bitmap'),
      );
      if (!(openButton instanceof HTMLButtonElement)) throw new Error('button missing');
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const select = host.querySelector('select[aria-label="Convert render type"]');
      const dpi = host.querySelector('input[aria-label="Convert DPI"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('render type select missing');
      if (!(dpi instanceof HTMLInputElement)) throw new Error('dpi input missing');
      await act(async () => {
        select.value = 'use-cut-settings';
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        dpi.value = '127';
        dpi.dispatchEvent(new Event('change', { bubbles: true }));
        dpi.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const form = host.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('dialog form missing');
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(bitmapMocks.buildBitmapFromVector).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'vec-1' }),
        expect.objectContaining({
          renderType: 'use-cut-settings',
          dpi: 127,
          layers: [
            { color: '#ff0000', mode: 'line' },
            { color: '#0000ff', mode: 'fill' },
          ],
        }),
      );
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

describe('Toolbar command buttons', () => {
  it('runs toolbar clicks through the command registry command object', async () => {
    const onNew = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands: ReadonlyArray<AppCommand> = [
      {
        id: 'file.new',
        family: 'file',
        label: 'New',
        title: 'New project',
        shortcut: 'Ctrl+N',
        enabled: true,
        invoke: onNew,
      },
    ];
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={commands} />);
      });

      const button = [...host.querySelectorAll('button')].find((item) =>
        item.textContent?.startsWith('New'),
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error('New button missing');
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onNew).toHaveBeenCalled();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
