import { act, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { DeviceSetupMachinePicker } from './DeviceSetupMachinePicker';
import { deviceSetupReducer, initDeviceSetup, type DeviceSetupState } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CNC presets in the machine list (ADR-636)', () => {
  it('keeps Onefinity geometry separate from firmware selection and output support', async () => {
    let snapshot: DeviceSetupState = initDeviceSetup(
      { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' },
      null,
      { machine: DEFAULT_CNC_MACHINE_CONFIG },
    );
    function Harness(): JSX.Element {
      const [state, dispatch] = useReducer(deviceSetupReducer, snapshot);
      snapshot = state;
      return <DeviceSetupMachinePicker state={state} dispatch={dispatch} />;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      const row = host.querySelector<HTMLInputElement>(
        'input[aria-label="Use Onefinity Woodworker (geometry only)"]',
      );
      if (row === null) throw new Error('Missing Onefinity row');
      await act(async () => row.click());

      expect(row.checked).toBe(true);
      expect(host.textContent).toContain('Geometry and spindle ceiling only');
      expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/MASSO/i);
      expect(host.textContent).toContain('selected controller unchanged');
      expect(host.querySelectorAll('a').length).toBeGreaterThan(0);
      expect(snapshot.machineKinds).toEqual(['cnc']);
      expect(snapshot.draft).toMatchObject({
        name: 'Onefinity Woodworker (geometry only)',
        bedWidth: 807,
        bedHeight: 765,
        controllerKind: 'grblhal',
      });
      expect(snapshot.cncDraft.params.spindleMaxRpm).toBe(24000);
      expect(snapshot.draft.gcodeDialect).toEqual(DEFAULT_DEVICE_PROFILE.gcodeDialect);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
