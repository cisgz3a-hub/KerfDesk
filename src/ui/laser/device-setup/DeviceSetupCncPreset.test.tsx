import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { DeviceSetupCncPreset } from './DeviceSetupCncPreset';
import { deviceSetupReducer, initDeviceSetup } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CNC geometry preset disclosure', () => {
  it('keeps Onefinity geometry separate from firmware selection and output support', async () => {
    let state = initDeviceSetup({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' }, null, {
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <DeviceSetupCncPreset
            state={state}
            dispatch={(action) => {
              state = deviceSetupReducer(state, action);
            }}
          />,
        ),
      );
      const select = host.querySelector('select');
      if (select === null) throw new Error('Missing CNC preset selector');
      await act(async () => {
        select.value = 'onefinity-woodworker';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(host.textContent).toContain('Geometry and spindle ceiling only');
      expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/MASSO/i);
      expect(host.textContent).toContain('selected controller unchanged');
      expect(host.querySelectorAll('a').length).toBeGreaterThan(0);
      await act(async () => host.querySelector('button')?.click());
      expect(state.draft).toMatchObject({
        bedWidth: 807,
        bedHeight: 765,
        controllerKind: 'grblhal',
      });
      expect(state.cncDraft.params.spindleMaxRpm).toBe(24000);
      expect(state.draft.gcodeDialect).toEqual(DEFAULT_DEVICE_PROFILE.gcodeDialect);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
