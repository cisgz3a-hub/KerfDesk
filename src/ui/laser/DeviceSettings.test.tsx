import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { DeviceSettings } from './DeviceSettings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDeviceSettings(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<DeviceSettings />);
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

describe('DeviceSettings air assist command', () => {
  it('lets the operator choose the GRBL air assist command', async () => {
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      const select = host.querySelector('select[aria-label="Air assist command"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Air assist command missing');
      expect(select.value).toBe('none');

      await act(async () => {
        select.value = 'M8';
        Simulate.change(select);
      });

      expect(useStore.getState().project.device.airAssistCommand).toBe('M8');
    } finally {
      await unmount();
    }
  });
});
