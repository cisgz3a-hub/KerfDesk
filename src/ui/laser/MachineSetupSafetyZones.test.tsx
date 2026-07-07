import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { SafetyZonesPanel } from './MachineSetupSafetyZones';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<SafetyZonesPanel />);
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

describe('MachineSetupSafetyZones', () => {
  it('lets numeric fields be cleared while editing', async () => {
    useStore.getState().updateDeviceProfile({
      noGoZones: [
        {
          id: 'clamp-left',
          name: 'Clamp left',
          enabled: true,
          x: 12,
          y: 4,
          width: 20,
          height: 18,
        },
      ],
    });
    const { host, unmount } = await renderPanel();
    try {
      const xInput = input(host, 'Safety zone 1 x');
      await act(async () => {
        xInput.value = '';
        Simulate.change(xInput);
      });
      expect(xInput.value).toBe('');
      expect(useStore.getState().project.device.noGoZones[0]?.x).toBe(12);

      await act(async () => {
        Simulate.blur(xInput);
      });
      expect(xInput.value).toBe('12');
    } finally {
      await unmount();
    }
  });
});

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Input not rendered: ${label}`);
  return match;
}
