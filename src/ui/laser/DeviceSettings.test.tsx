import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('applies the Neotronics 4040 Max laser profile deliberately and lets Z be confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      const apply = button(host, 'Use Neotronics 4040 Max');
      await act(async () => {
        apply.click();
      });

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Neotronics 4040 Max'));
      expect(useStore.getState().project.device).toMatchObject({
        machineFamily: 'neotronics-4040-max',
        laserSubProfile: { model: 'LASER TREE LT-4LDS-V2' },
        zTravelMm: 75,
        zTravelConfirmed: false,
      });

      const confirmed = host.querySelector('input[aria-label="Z travel confirmed"]');
      if (!(confirmed instanceof HTMLInputElement)) throw new Error('Z confirm checkbox missing');
      await act(async () => {
        confirmed.checked = true;
        Simulate.change(confirmed);
      });

      expect(useStore.getState().project.device.zTravelConfirmed).toBe(true);
    } finally {
      confirm.mockRestore();
      await unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
