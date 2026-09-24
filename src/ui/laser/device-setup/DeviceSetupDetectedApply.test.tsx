// DeviceSetupDetectedApply — Machine Setup's "Use detected values" action. A
// detected CNC S maximum becomes spindle RPM only through the operator's explicit
// mapping choice for the current connection (ADR-322 §6). These cases moved here
// from the removed CNC rail row that shared the same choice hook (ADR-365).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { useLaserStore } from '../../state/laser-store';
import { DeviceSetupDetectedApply } from './DeviceSetupDetectedApply';
import { initDeviceSetup } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CNC_READBACK: Partial<DeviceProfile> = {
  maxPowerS: 24000,
  laserModeEnabled: false,
  bedWidth: 750,
};

afterEach(() => {
  useLaserStore.setState({ controllerSessionEpoch: 0 });
});

describe('DeviceSetupDetectedApply', () => {
  it('copies a CNC S maximum as spindle RPM only after the mapping is selected', async () => {
    const view = await renderApply(CNC_READBACK);
    try {
      expect(mappingBox(view.host)?.checked).toBe(false);
      await act(async () => detectedButton(view.host).click());
      expect(view.dispatch).toHaveBeenLastCalledWith({
        kind: 'accept-detected',
        patch: CNC_READBACK,
        useSpindleScaleAsRpm: false,
      });
      await act(async () => mappingBox(view.host)?.click());
      await act(async () => detectedButton(view.host).click());
      expect(view.dispatch).toHaveBeenLastCalledWith({
        kind: 'accept-detected',
        patch: CNC_READBACK,
        useSpindleScaleAsRpm: true,
      });
    } finally {
      await view.unmount();
    }
  });

  it('requires a new RPM mapping after reconnecting to a controller with the same S scale', async () => {
    useLaserStore.setState({ controllerSessionEpoch: 1 });
    const view = await renderApply(CNC_READBACK);
    try {
      await act(async () => mappingBox(view.host)?.click());
      expect(mappingBox(view.host)?.checked).toBe(true);
      await act(async () => useLaserStore.setState({ controllerSessionEpoch: 2 }));
      expect(mappingBox(view.host)?.checked).toBe(false);
      await act(async () => detectedButton(view.host).click());
      expect(view.dispatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ useSpindleScaleAsRpm: false }),
      );
    } finally {
      await view.unmount();
    }
  });

  it('never offers a laser-mode $30 as spindle RPM', async () => {
    const view = await renderApply({ maxPowerS: 1000, laserModeEnabled: true, bedWidth: 300 });
    try {
      expect(mappingBox(view.host)).toBeNull();
      await act(async () => detectedButton(view.host).click());
      expect(view.dispatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ useSpindleScaleAsRpm: false }),
      );
    } finally {
      await view.unmount();
    }
  });
});

async function renderApply(detected: Partial<DeviceProfile>): Promise<{
  readonly host: HTMLDivElement;
  readonly dispatch: ReturnType<typeof vi.fn>;
  readonly unmount: () => Promise<void>;
}> {
  const state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, detected, {
    machine: DEFAULT_CNC_MACHINE_CONFIG,
  });
  const dispatch = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<DeviceSetupDetectedApply state={state} dispatch={dispatch} detected={detected} />);
  });
  return {
    host,
    dispatch,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function mappingBox(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[aria-label="Use S maximum as spindle RPM"]');
}

function detectedButton(host: HTMLElement): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Use detected values',
  );
  if (match === undefined) throw new Error('Use detected values button missing');
  return match;
}
