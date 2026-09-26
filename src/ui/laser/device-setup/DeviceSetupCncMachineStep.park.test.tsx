// ADR-392 Amendment 1 (CNC audit MC-7): no park is its own state. Since a park
// is a bed position, 0, 0 is a real place on the bed, so Park X and Y sit
// behind a toggle that removes both fields instead of leaving 0, 0 behind.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncMachineConfig,
  type CncMachineParams,
} from '../../../core/scene';
import { initDeviceSetup } from './device-setup-flow';
import { DeviceSetupCncMachineStep } from './DeviceSetupCncMachineStep';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderStep(machine: CncMachineConfig): ReturnType<typeof vi.fn> {
  const dispatch = vi.fn();
  act(() =>
    root.render(
      <DeviceSetupCncMachineStep
        state={initDeviceSetup(DEFAULT_DEVICE_PROFILE, null)}
        dispatch={dispatch}
        machine={machine}
      />,
    ),
  );
  return dispatch;
}

function parkToggle(): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>('input[aria-label="Park at a bed position"]');
  if (node === null) throw new Error('Missing park toggle');
  return node;
}

function editedParams(dispatch: ReturnType<typeof vi.fn>): CncMachineParams {
  const action = dispatch.mock.calls.at(-1)?.[0] as { machine: CncMachineConfig } | undefined;
  if (action === undefined) throw new Error('No machine edit dispatched');
  return action.machine.params;
}

function parked(x: number, y: number): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, parkXMm: x, parkYMm: y },
  };
}

describe('Machine Setup park (ADR-392 Amendment 1)', () => {
  it('shows no park fields while no park is set', () => {
    renderStep(DEFAULT_CNC_MACHINE_CONFIG);

    expect(parkToggle().checked).toBe(false);
    expect(host.querySelector('input[aria-label="Park X"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Park Y"]')).toBeNull();
  });

  it('starts a new park at bed 0, 0 when it is turned on', () => {
    const dispatch = renderStep(DEFAULT_CNC_MACHINE_CONFIG);

    act(() => parkToggle().click());

    expect(editedParams(dispatch)).toMatchObject({ parkXMm: 0, parkYMm: 0 });
  });

  it('removes both fields when the park is turned off, rather than leaving 0, 0', () => {
    const dispatch = renderStep(parked(10, 380));
    expect(parkToggle().checked).toBe(true);

    act(() => parkToggle().click());

    const params = editedParams(dispatch);
    expect('parkXMm' in params).toBe(false);
    expect('parkYMm' in params).toBe(false);
    expect(params.safeZMm).toBe(DEFAULT_CNC_MACHINE_CONFIG.params.safeZMm);
  });

  it('shows the configured bed position in Park X and Y', () => {
    renderStep(parked(10, 380));

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Park X"]')?.value).toBe('10');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Park Y"]')?.value).toBe('380');
  });
});
