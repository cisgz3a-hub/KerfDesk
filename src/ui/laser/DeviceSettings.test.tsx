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

      const select = host.querySelector('select[aria-label="Air output command"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Air output command missing');
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

  it('lets the operator declare whether the machine has powered Z jog', async () => {
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      const poweredZ = host.querySelector('input[aria-label="Powered Z jog enabled"]');
      if (!(poweredZ instanceof HTMLInputElement)) throw new Error('Powered Z checkbox missing');
      expect(poweredZ.checked).toBe(false);
      expect(useStore.getState().project.device.capabilities).not.toContain('z-axis');

      await act(async () => {
        poweredZ.checked = true;
        Simulate.change(poweredZ);
      });

      expect(useStore.getState().project.device.capabilities).toContain('z-axis');

      await act(async () => {
        poweredZ.checked = false;
        Simulate.change(poweredZ);
      });

      expect(useStore.getState().project.device.capabilities).not.toContain('z-axis');
    } finally {
      await unmount();
    }
  });

  it('keeps Z travel confirmation disabled until powered Z and travel are present', async () => {
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      const confirmed = input(host, 'Z travel confirmed');
      expect(confirmed.disabled).toBe(true);

      const poweredZ = host.querySelector('input[aria-label="Powered Z jog enabled"]');
      if (!(poweredZ instanceof HTMLInputElement)) throw new Error('Powered Z checkbox missing');
      await act(async () => {
        poweredZ.checked = true;
        Simulate.change(poweredZ);
      });
      expect(confirmed.disabled).toBe(true);

      const travel = input(host, 'Z travel (mm)');
      await act(async () => {
        travel.value = '75';
        Simulate.change(travel);
      });

      expect(input(host, 'Z travel confirmed').disabled).toBe(false);
    } finally {
      await unmount();
    }
  });

  it('clears Z travel confirmation when powered Z jog is disabled', async () => {
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl', 'z-axis'],
      zTravelMm: 75,
      zTravelConfirmed: true,
    });
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      const poweredZ = host.querySelector('input[aria-label="Powered Z jog enabled"]');
      if (!(poweredZ instanceof HTMLInputElement)) throw new Error('Powered Z checkbox missing');
      expect(useStore.getState().project.device.zTravelConfirmed).toBe(true);

      await act(async () => {
        poweredZ.checked = false;
        Simulate.change(poweredZ);
      });

      expect(useStore.getState().project.device.capabilities).not.toContain('z-axis');
      expect(useStore.getState().project.device.zTravelConfirmed).toBe(false);
    } finally {
      await unmount();
    }
  });

  it('does not inherit stale Z travel confirmation when powered Z jog is enabled', async () => {
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl'],
      zTravelMm: 75,
      zTravelConfirmed: true,
    });
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      const poweredZ = host.querySelector('input[aria-label="Powered Z jog enabled"]');
      if (!(poweredZ instanceof HTMLInputElement)) throw new Error('Powered Z checkbox missing');

      await act(async () => {
        poweredZ.checked = true;
        Simulate.change(poweredZ);
      });

      expect(useStore.getState().project.device.capabilities).toContain('z-axis');
      expect(useStore.getState().project.device.zTravelConfirmed).toBe(false);
    } finally {
      await unmount();
    }
  });
});

describe('DeviceSettings in CNC mode (ADR-101 §6)', () => {
  it('hides the laser-only fields but keeps the machine-agnostic ones', async () => {
    useStore.getState().setMachineKind('cnc');
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      expect(host.querySelector('select[aria-label="Air output command"]')).toBeNull();
      expect(host.querySelector('input[aria-label="GRBL $30 max power S"]')).toBeNull();
      expect(host.textContent).not.toContain('Scan offset');
      expect(host.textContent).not.toContain('Auto-focus command');

      expect(host.querySelector('input[aria-label="Z travel (mm)"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Powered Z jog enabled"]')).not.toBeNull();
    } finally {
      await unmount();
    }
  });
});

describe('DeviceSettings low-power Fire', () => {
  it('requires explicit profile enablement on an approved device', async () => {
    useStore.getState().updateDeviceProfile({
      capabilities: [...(useStore.getState().project.device.capabilities ?? []), 'low-power-fire'],
    });
    const { host, unmount } = await renderDeviceSettings();
    try {
      const enabled = input(host, 'Enable low-power Fire for this machine');
      expect(enabled.checked).toBe(false);

      await act(async () => {
        enabled.checked = true;
        Simulate.change(enabled);
      });

      expect(useStore.getState().project.device.fireControl).toEqual({
        enabled: true,
        maxPowerPercent: 1,
      });
      expect(input(host, 'Maximum Fire power percent').max).toBe('5');
    } finally {
      await unmount();
    }
  });
});

describe('DeviceSettings scan offsets', () => {
  it('lets the operator edit calibrated scan-offset points on the device profile', async () => {
    const { host, unmount } = await renderDeviceSettings();
    try {
      const details = host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Device details missing');
      details.open = true;

      await act(async () => {
        button(host, 'Add offset').click();
      });

      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 3000, offsetMm: 0 },
      ]);

      const speed = input(host, 'Scan offset speed 1');
      await act(async () => {
        speed.value = '6000';
        Simulate.change(speed);
      });

      const offset = input(host, 'Scan offset value 1');
      await act(async () => {
        offset.value = '0.12';
        Simulate.change(offset);
      });

      await act(async () => {
        button(host, 'Add offset').click();
      });

      const secondOffset = input(host, 'Scan offset value 2');
      await act(async () => {
        secondOffset.value = '0.05';
        Simulate.change(secondOffset);
      });

      const updatedSecondSpeed = input(host, 'Scan offset speed 2');
      await act(async () => {
        updatedSecondSpeed.value = '3000';
        Simulate.change(updatedSecondSpeed);
      });

      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 3000, offsetMm: 0.05 },
        { speedMmPerMin: 6000, offsetMm: 0.12 },
      ]);

      await act(async () => {
        button(host, 'Remove scan offset 1').click();
      });

      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 6000, offsetMm: 0.12 },
      ]);
    } finally {
      await unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.includes(label) ||
      candidate.getAttribute('aria-label')?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Input not rendered: ${label}`);
  return match;
}
