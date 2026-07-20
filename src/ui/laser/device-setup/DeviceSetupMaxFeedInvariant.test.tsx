import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import { deviceSetupReducer, initDeviceSetup } from './device-setup-flow';
import { DeviceSetupSafetyStep } from './DeviceSetupSafetyStep';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Device Setup controlled travel feed invariant', () => {
  it('clamps the draft and renders the clamped value after max feed is lowered', async () => {
    const initial = initDeviceSetup(
      {
        ...DEFAULT_DEVICE_PROFILE,
        maxFeed: 1000,
        controlledLaserOffTravelFeedMmPerMin: 800,
      },
      null,
      { machine: LASER_MACHINE_CONFIG },
    );
    const state = deviceSetupReducer(initial, { kind: 'edit', patch: { maxFeed: 500 } });
    expect(state.draft.controlledLaserOffTravelFeedMmPerMin).toBe(500);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(<DeviceSetupSafetyStep state={state} dispatch={vi.fn()} />),
      );
      const field = host.querySelector('input[aria-label="Controlled laser-off seek feed"]');
      expect(field).toBeInstanceOf(HTMLInputElement);
      expect((field as HTMLInputElement).value).toBe('500');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
