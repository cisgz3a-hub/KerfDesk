// A Speed typed above the machine's Output max feed used to snap back to the
// ceiling without a word, which reads as "speed is stuck and doesn't want to
// increase" (controller audit 2026-09-23, speed-3; WORKFLOW.md F-A7). The
// oracle is what the operator can see and what the store will compile.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { ReviewNumberCell } from '../laser/job-review/ReviewNumberCell';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SPEED_SELECTOR = 'input[aria-label="Speed for selected objects"]';

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

async function render(node: JSX.Element): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(node);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function renderPanel(): ReturnType<typeof render> {
  return render(
    <PlatformProvider adapter={mockPlatform}>
      <CutsLayersPanel />
    </PlatformProvider>,
  );
}

function input(host: HTMLElement, selector: string): HTMLInputElement {
  const element = host.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${selector} missing`);
  return element;
}

function typeAndBlur(element: HTMLInputElement, value: string): void {
  act(() => {
    element.value = value;
    Simulate.change(element);
  });
  act(() => {
    Simulate.blur(element);
  });
}

function storedSpeed(): number | undefined {
  return useStore.getState().project.scene.layers[0]?.speed;
}

function notice(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.lf-feed-ceiling-note');
}

function selectImportedArtwork(): void {
  useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
  useStore.getState().updateDeviceProfile({ maxFeed: 10000 });
}

afterEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Speed above Output max feed', () => {
  it('says why the value was capped and keeps what the operator asked for', async () => {
    selectImportedArtwork();
    const { host, unmount } = await renderPanel();
    try {
      typeAndBlur(input(host, SPEED_SELECTOR), '15000');

      // The ceiling still applies: the store never holds more than it.
      expect(storedSpeed()).toBe(10000);
      expect(input(host, SPEED_SELECTOR).value).toBe('10000');
      const note = notice(host);
      expect(note?.textContent).toContain('15,000 mm/min is above this machine');
      expect(note?.textContent).toContain('runs at 10,000 mm/min');
      expect(note?.getAttribute('role')).toBe('status');
      expect(input(host, SPEED_SELECTOR).title).toContain('Output max feed, 10000 mm/min');
    } finally {
      await unmount();
    }
  });

  it('raises the ceiling and applies the requested speed in one click', async () => {
    selectImportedArtwork();
    const { host, unmount } = await renderPanel();
    try {
      typeAndBlur(input(host, SPEED_SELECTOR), '15000');
      const raise = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Raise Output max feed to 15,000 mm/min',
      );
      if (raise === undefined) throw new Error('raise button missing');
      act(() => {
        Simulate.click(raise);
      });

      expect(useStore.getState().project.device.maxFeed).toBe(15000);
      expect(storedSpeed()).toBe(15000);
      expect(input(host, SPEED_SELECTOR).value).toBe('15000');
      expect(notice(host)).toBeNull();
    } finally {
      await unmount();
    }
  });

  it('flags a stored speed that compile will cap, without any typing', async () => {
    selectImportedArtwork();
    const operationId = useStore.getState().project.scene.layers[0]?.id;
    if (operationId === undefined) throw new Error('operation missing');
    useStore.getState().setLayerParam(operationId, { speed: 12000 });
    const { host, unmount } = await renderPanel();
    try {
      expect(notice(host)?.textContent).toContain('12,000 mm/min is above this machine');
    } finally {
      await unmount();
    }
  });

  it('stays quiet for a speed inside the ceiling', async () => {
    selectImportedArtwork();
    const { host, unmount } = await renderPanel();
    try {
      typeAndBlur(input(host, SPEED_SELECTOR), '8000');
      expect(storedSpeed()).toBe(8000);
      expect(notice(host)).toBeNull();
    } finally {
      await unmount();
    }
  });

  it('reports a capped Job Review speed instead of snapping silently', async () => {
    const commits: number[] = [];
    const clamps: number[] = [];
    const { host, unmount } = await render(
      <table>
        <tbody>
          <tr>
            <ReviewNumberCell
              label="Speed mm/min for Cut"
              value={1000}
              min={1}
              max={10000}
              onCommit={(value) => commits.push(value)}
              onClamp={(requested) => clamps.push(requested)}
            />
          </tr>
        </tbody>
      </table>,
    );
    try {
      typeAndBlur(input(host, 'input[aria-label="Speed mm/min for Cut"]'), '12000');
      expect(clamps).toEqual([12000]);
      expect(commits.at(-1)).toBe(10000);

      typeAndBlur(input(host, 'input[aria-label="Speed mm/min for Cut"]'), '9000');
      expect(clamps).toEqual([12000]);
    } finally {
      await unmount();
    }
  });
});
