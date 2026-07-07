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
  buildBitmapFromVectors: vi.fn(),
}));

vi.mock('../raster/vector-to-bitmap', async (importOriginal) => {
  const actual = await importOriginal<typeof VectorToBitmap>();
  return {
    ...actual,
    buildBitmapFromVectors: bitmapMocks.buildBitmapFromVectors,
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
  bitmapMocks.buildBitmapFromVectors.mockReset();
  vi.restoreAllMocks();
});

describe('Toolbar Convert to Bitmap', () => {
  it('opens the LightBurn-style options dialog and passes Render Type plus DPI', async () => {
    installVectorProject();
    bitmapMocks.buildBitmapFromVectors.mockResolvedValue(convertedRaster());
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

      expect(bitmapMocks.buildBitmapFromVectors).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'vec-1' })],
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

describe('Toolbar shortcut hint (audit M27/A.5)', () => {
  it('renders the KerfDesk product name in the app chrome', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={[]} machineKind="laser" />);
      });

      expect(host.textContent).toContain('KerfDesk');
      expect(host.textContent).not.toContain('LaserForge');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('does not render the desktop-download or PWA-install affordances (removed for now)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={[]} machineKind="laser" />);
      });

      // Both were toolbar-mounted (ADR-024 / ADR-060) and are temporarily
      // withdrawn; the components themselves still exist under ui/common.
      expect(host.textContent).not.toContain('Download for Windows');
      expect(host.textContent).not.toContain('Install app');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('lists every shipped shortcut family, including the late arrivals', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={[]} machineKind="laser" />);
      });

      const hint = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Shortcuts',
      );
      const title = hint?.getAttribute('title') ?? '';
      // Shipped shortcuts the hint used to omit:
      expect(title).toContain('Ctrl+D'); // duplicate (shortcuts.ts)
      expect(title).toContain('Shift+F'); // fit-to-selection
      expect(title).toContain('Ctrl+Enter'); // start job (M22)
      expect(title).toContain('Ctrl+.'); // stop job (M22)
      expect(title).toContain('Ctrl+Shift+E'); // save G-code
      expect(title).not.toContain('Ctrl+E export G-code'); // reserved for future ellipse tool
      expect(title.toLowerCase()).toContain('right-drag'); // pan
      expect(title).toContain('Laser: Ctrl+Enter');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('opens the Keyboard Shortcuts dialog from the toolbar button', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={[]} machineKind="laser" />);
      });

      const hint = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Shortcuts',
      );
      if (!(hint instanceof HTMLButtonElement)) throw new Error('Shortcuts button missing');
      await act(async () => {
        hint.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const dialog = host.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain('Keyboard Shortcuts');
      expect(dialog?.textContent).toContain('Ctrl+N');

      const close = [...(dialog?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === 'Close',
      );
      await act(async () => {
        close?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('labels the job-control shortcuts with the machine noun in CNC mode (ADR-101 §7)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={[]} machineKind="cnc" />);
      });

      const hint = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Shortcuts',
      );
      const title = hint?.getAttribute('title') ?? '';
      expect(title).toContain('Router: Ctrl+Enter');
      expect(title).not.toContain('Laser:');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

describe('Toolbar separators', () => {
  const command = (id: AppCommand['id'], label: string): AppCommand => ({
    id,
    family: 'file',
    label,
    title: label,
    enabled: true,
    invoke: vi.fn(),
  });

  it('renders separators only between non-empty groups plus the two structural ones', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        // file.new and window.toggle-preview live in different toolbar groups.
        root.render(
          <Toolbar
            commands={[command('file.new', 'New'), command('window.toggle-preview', 'Preview')]}
            machineKind="laser"
          />,
        );
      });

      const separators = host.querySelectorAll('[role="separator"]');
      // 1 structural (after the badges) + 1 between the two visible groups.
      expect(separators).toHaveLength(2);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('renders no group separator and no double separator when only one group is visible', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={[command('file.new', 'New')]} machineKind="laser" />);
      });

      const separators = [...host.querySelectorAll('[role="separator"]')];
      expect(separators).toHaveLength(1);
      // The empty-group bug rendered adjacent separators (a stray "| |").
      for (const separator of separators) {
        expect(separator.nextElementSibling?.getAttribute('role')).not.toBe('separator');
      }
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
        root.render(<Toolbar commands={commands} machineKind="laser" />);
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

  it('marks toolbar command buttons with stable help ids', async () => {
    const onNew = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands: ReadonlyArray<AppCommand> = [
      {
        id: 'file.new',
        family: 'file',
        label: 'New',
        title: 'Create a new blank project.',
        shortcut: 'Ctrl+N',
        enabled: true,
        invoke: onNew,
      },
    ];
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Toolbar commands={commands} machineKind="laser" />);
      });

      const button = host.querySelector('button[data-help-id="command:file.new"]');
      expect(button?.getAttribute('title')).toBe('Create a new blank project. (Ctrl+N)');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
