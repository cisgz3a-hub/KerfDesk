// ADR-401: CNC keeps its own Max feed and Frame speed in the CNC step.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncMachineConfig } from '../../../core/scene';
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

const device = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000, framingFeedMmPerMin: 3000 };

function renderStep(machine: CncMachineConfig): ReturnType<typeof vi.fn> {
  const dispatch = vi.fn();
  act(() =>
    root.render(
      <DeviceSetupCncMachineStep
        state={initDeviceSetup(device, null)}
        dispatch={dispatch}
        machine={machine}
      />,
    ),
  );
  return dispatch;
}

function field(label: string): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (node === null) throw new Error(`Missing ${label}`);
  return node;
}

describe('Machine Setup CNC speeds (ADR-401)', () => {
  it('shows the device speeds for a CNC setup that has none of its own yet', () => {
    renderStep(DEFAULT_CNC_MACHINE_CONFIG);

    expect(field('CNC output max feed').value).toBe('6000');
    expect(field('CNC frame feed').value).toBe('3000');
  });

  it('shows and edits the CNC speeds on the CNC params only', () => {
    const dispatch = renderStep({
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, maxFeedMmPerMin: 1500 },
    });
    expect(field('CNC output max feed').value).toBe('1500');

    const input = field('CNC output max feed');
    act(() => {
      input.value = '1200';
      Simulate.change(input);
    });
    act(() => Simulate.blur(input));

    const action = dispatch.mock.calls.at(-1)?.[0] as
      | { kind: string; machine: CncMachineConfig }
      | undefined;
    expect(action?.kind).toBe('edit-machine');
    expect(action?.machine.params.maxFeedMmPerMin).toBe(1200);
  });
});
