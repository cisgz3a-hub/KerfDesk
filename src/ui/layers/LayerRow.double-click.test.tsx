import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { StreamerState } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
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

afterEach(() => {
  resetStore();
  useUiStore.getState().setActiveLayerColor(null);
  useLaserStore.setState({
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('LayerRow double-click cut settings', () => {
  it('selects a layer row as the current drawing layer', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<PanelUnderTest />);
      });

      const row = host.querySelector('section[aria-label="Layer #ff0000"]');
      if (!(row instanceof HTMLElement)) throw new Error('layer row missing');
      await act(async () => {
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useUiStore.getState().activeLayerColor).toBe('#ff0000');
      expect(row.getAttribute('aria-current')).toBe('true');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('opens the cut settings dialog by double-clicking a layer entry', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<PanelUnderTest />);
      });

      const row = host.querySelector('section[aria-label="Layer #ff0000"]');
      if (!(row instanceof HTMLElement)) throw new Error('layer row missing');
      await act(async () => {
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('does not open cut settings when double-clicking an interactive layer control', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<PanelUnderTest />);
      });

      const mode = host.querySelector('select[aria-label="Mode for #ff0000"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('mode select missing');
      await act(async () => {
        mode.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('does not open cut settings when double-clicking an interactive layer label', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<PanelUnderTest />);
      });

      const showToggle = Array.from(host.querySelectorAll('label')).find((label) =>
        label.textContent?.includes('Show'),
      );
      if (!(showToggle instanceof HTMLLabelElement)) throw new Error('show label missing');
      await act(async () => {
        showToggle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it.each([
    ['active job', () => useLaserStore.setState({ streamer: activeStreamer() })],
    [
      'active frame',
      () =>
        useLaserStore.setState({
          motionOperation: {
            kind: 'frame',
            sawControllerBusy: true,
            idleStatusReports: 0,
            dispatchComplete: true,
          },
        }),
    ],
    ['active autofocus', () => useLaserStore.setState({ autofocusBusy: true })],
  ] as const)('blocks cut settings while %s is running', async (_label, makeBusy) => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    makeBusy();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<PanelUnderTest />);
      });

      const edit = host.querySelector('button[aria-label="Edit cut settings for #ff0000"]');
      if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button missing');
      expect(edit.disabled).toBe(true);

      const row = host.querySelector('section[aria-label="Layer #ff0000"]');
      if (!(row instanceof HTMLElement)) throw new Error('layer row missing');
      await act(async () => {
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('closes an open cut settings dialog when machine activity starts', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<PanelUnderTest />);
      });

      const edit = host.querySelector('button[aria-label="Edit cut settings for #ff0000"]');
      if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button missing');
      await act(async () => {
        edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();

      await act(async () => {
        useLaserStore.setState({ autofocusBusy: true });
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function activeStreamer(): StreamerState {
  return { status: 'streaming' } as StreamerState;
}
