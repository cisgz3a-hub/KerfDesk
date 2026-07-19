import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { StreamerState } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
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

afterEach(() => {
  resetStore();
  useUiStore.getState().setActiveLayerColor(null);
  useLaserStore.setState({
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('compact operation row and selected operation settings', () => {
  it('makes an operation row the current drawing color without putting settings in the row', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const mounted = await mountPanel();
    try {
      const row = operationRow(mounted.host);
      await click(row);

      expect(useUiStore.getState().activeLayerColor).toBe('#000000');
      expect(row.getAttribute('aria-current')).toBe('true');
      expect(row.querySelector('select')).toBeNull();
      expect(row.textContent).not.toContain('Advanced cut settings');
    } finally {
      await mounted.unmount();
    }
  });

  it('opens advanced settings from the selected artwork inspector', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const mounted = await mountPanel();
    try {
      await click(advancedButton(mounted.host));
      expect(mounted.host.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it.each([
    ['active job', () => useLaserStore.setState({ streamer: activeStreamer() })],
    [
      'active frame',
      () =>
        useLaserStore.setState({
          motionOperation: {
            operationId: 1,
            kind: 'frame',
            sawControllerBusy: true,
            idleStatusReports: 0,
            dispatchComplete: true,
            pendingLines: [],
          },
        }),
    ],
    ['active autofocus', () => useLaserStore.setState({ autofocusBusy: true })],
  ] as const)('blocks advanced settings during %s', async (_label, makeBusy) => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    makeBusy();
    const mounted = await mountPanel();
    try {
      expect(advancedButton(mounted.host).disabled).toBe(true);
      expect(mounted.host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it('closes advanced settings when machine activity starts', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const mounted = await mountPanel();
    try {
      await click(advancedButton(mounted.host));
      expect(mounted.host.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => useLaserStore.setState({ autofocusBusy: true }));
      expect(mounted.host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });
});

async function mountPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <CutsLayersPanel />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function operationRow(host: HTMLElement): HTMLElement {
  const row = host.querySelector('section[aria-label="Operation O1"]');
  if (!(row instanceof HTMLElement)) throw new Error('operation row missing');
  return row;
}

function advancedButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Advanced cut settings',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('advanced settings button missing');
  return button;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function activeStreamer(): StreamerState {
  return { status: 'streaming' } as StreamerState;
}
