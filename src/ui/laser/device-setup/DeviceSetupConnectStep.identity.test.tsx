// Find my machine separates a driver that differs from the setup, which a
// reconnect fixes, from a banner that differs, which it cannot: Connect binds
// the driver from the setup and a banner never switches it. Using the banner's
// family in the draft lists what else that changes and waits for Apply
// (ADR-375).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import { PlatformProvider } from '../../app/platform-context';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { initDeviceSetup } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();
const platform = {
  id: 'mock' as const,
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => true, requestPort: async () => null },
};
const CALIBRATED_FALCON: DeviceProfile = {
  ...FALCON_A1_PRO_GRBLHAL_PROFILE,
  scanningOffsets: [
    { speedMmPerMin: 3000, offsetMm: 0.1 },
    { speedMmPerMin: 6000, offsetMm: 0.18 },
  ],
  scanOffsetCalibrationStatus: 'verified',
};
const FALCON_CONNECTION: Partial<LaserState> = {
  connection: { kind: 'connected' },
  activeControllerKind: 'grblhal',
  activeControllerCommandSet: 'creality-falcon-a1-pro',
};
const GRBLHAL_PROFILE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' };
const GRBLHAL_CONNECTION: Partial<LaserState> = {
  connection: { kind: 'connected' },
  activeControllerKind: 'grblhal',
  activeControllerCommandSet: null,
};
const CHANGES = '[aria-label="Changes from using GRBL v1.1"]';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(original, true);
});

function renderStep(profile: DeviceProfile, live: Partial<LaserState>) {
  const dispatch = vi.fn();
  useLaserStore.setState(live);
  act(() =>
    root.render(
      <PlatformProvider adapter={platform}>
        <DeviceSetupConnectStep state={initDeviceSetup(profile, null)} dispatch={dispatch} />
      </PlatformProvider>,
    ),
  );
  return dispatch;
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
}

function button(text: string): HTMLButtonElement {
  const node = findButton(text);
  if (node === undefined) throw new Error(`Missing button: ${text}`);
  return node;
}

describe('Find my machine identity (ADR-375)', () => {
  // grblHAL prints "Grbl 1.1f" at COMPATIBILITY_LEVEL >= 1 and never another
  // Grbl version (grblHAL core report.c#L311-L315, grbl.h#L40-L44), so a
  // "Grbl 1.1h" banner on the grblHAL driver reads as stock GRBL.
  it('keeps read-only checks available when only the banner differs', () => {
    renderStep(GRBLHAL_PROFILE, { ...GRBLHAL_CONNECTION, detectedControllerKind: 'grbl-v1.1' });
    expect(host.textContent).toContain('The firmware banner differs from this setup.');
    expect(host.textContent).not.toContain('The connection does not match this setup.');
    expect(host.textContent).toContain('Reconnecting with this setup hears the same banner.');
    expect(findButton('Reconnect using selected profile')).toBeUndefined();
    expect(button('Read again').disabled).toBe(false);
  });

  it('offers Reconnect and holds read-only checks when the active command set differs', () => {
    renderStep(FALCON_A1_PRO_GRBLHAL_PROFILE, {
      ...FALCON_CONNECTION,
      activeControllerCommandSet: null,
      detectedControllerKind: 'grblhal',
    });
    expect(host.textContent).toContain('The connection does not match this setup.');
    expect(button('Reconnect using selected profile')).toBeDefined();
    expect(button('Read again').disabled).toBe(true);
  });

  it('names the command set the connection uses when it differs from the setup', () => {
    renderStep(GRBLHAL_PROFILE, { ...FALCON_CONNECTION, detectedControllerKind: 'grblhal' });
    expect(host.textContent).toContain(
      'Connected as Falcon A1 Pro (GRBL-compatible commands); the controller reports grblHAL; ' +
        'this setup uses grblHAL.',
    );
    expect(button('Reconnect using selected profile')).toBeDefined();
  });

  it('lists the receive window and scan calibration a GRBL relabel changes before applying', () => {
    const dispatch = renderStep(CALIBRATED_FALCON, {
      ...FALCON_CONNECTION,
      detectedControllerKind: 'grbl-v1.1',
    });
    act(() => button('Use detected GRBL v1.1 in draft').click());
    const changes = host.querySelector(CHANGES);
    expect(changes?.textContent).toContain('RX window: 1024 bytes → 120 bytes');
    expect(changes?.textContent).toContain(
      'Raster scan-offset calibration: 2 points, verified → Not calibrated',
    );
    expect(dispatch).not.toHaveBeenCalled();

    act(() => button('Cancel').click());
    expect(dispatch).not.toHaveBeenCalled();
    expect(host.querySelector(CHANGES)).toBeNull();

    act(() => button('Use detected GRBL v1.1 in draft').click());
    act(() => button('Apply to draft').click());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      kind: 'select-controller',
      controllerKind: 'grbl-v1.1',
    });
  });

  it('uses a detected family at once when it changes nothing else in the draft', () => {
    const dispatch = renderStep(
      { ...GRBLHAL_PROFILE, rxBufferBytes: 2048 },
      { ...GRBLHAL_CONNECTION, detectedControllerKind: 'grbl-v1.1' },
    );
    act(() => button('Use detected GRBL v1.1 in draft').click());
    expect(host.querySelector(CHANGES)).toBeNull();
    expect(dispatch).toHaveBeenCalledWith({
      kind: 'select-controller',
      controllerKind: 'grbl-v1.1',
    });
  });
});
