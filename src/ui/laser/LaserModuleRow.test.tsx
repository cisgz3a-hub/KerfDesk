import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
// Deep imports: the devices barrel is at its public-export ratchet.
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  FALCON_A1_PRO_BLUE_20W_MODULE,
  FALCON_A1_PRO_INFRARED_2W_MODULE,
} from '../../core/devices/laser-modules';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { laserModuleFacts } from './job-review/job-review-laser-module';
import { LaserModuleRow } from './LaserModuleRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function select(): HTMLSelectElement | null {
  return host.querySelector<HTMLSelectElement>('select[aria-label="Laser module"]');
}

function pick(value: string): void {
  const element = select();
  if (element === null) throw new Error('no module select');
  act(() => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('the fitted laser module (ADR-503)', () => {
  it('swaps the Falcon A1 Pro head to the infrared module and back, undoably', () => {
    act(() => useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE));
    act(() => root.render(<LaserModuleRow />));
    expect(select()?.value).toBe('0');
    expect([...(select()?.options ?? [])].map((option) => option.text)).toEqual([
      '20 W blue (455 nm)',
      '2 W infrared (1064 nm)',
    ]);

    pick('1');
    const device = useStore.getState().project.device;
    expect(device.laserSubProfile).toEqual(FALCON_A1_PRO_INFRARED_2W_MODULE);
    // Only the head changes: the machine and its output stay as they were.
    expect({ ...device, laserSubProfile: undefined }).toEqual({
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      laserSubProfile: undefined,
    });
    expect(select()?.value).toBe('1');

    act(() => useStore.getState().undo());
    expect(useStore.getState().project.device.laserSubProfile).toEqual(
      FALCON_A1_PRO_BLUE_20W_MODULE,
    );
  });

  it('asks for the fitted module on a Falcon saved before it had one', () => {
    const { laserSubProfile: _head, ...saved } = FALCON_A1_PRO_GRBLHAL_PROFILE;
    act(() => useStore.getState().replaceDeviceProfile(saved));
    act(() => root.render(<LaserModuleRow />));
    expect(select()?.value).toBe('');
    expect(laserModuleFacts(useStore.getState().project.device)).toEqual([
      {
        label: 'Laser module',
        value: 'Not chosen · pick the fitted one under Laser module',
        tone: 'warning',
      },
    ]);
    pick('0');
    expect(useStore.getState().project.device.laserSubProfile).toEqual(
      FALCON_A1_PRO_BLUE_20W_MODULE,
    );
    expect(laserModuleFacts(useStore.getState().project.device)).toEqual([
      {
        label: 'Laser module',
        value: '20 W blue (455 nm) · prepared for this one; check it is fitted',
        tone: 'default',
      },
    ]);
  });

  it('shows nothing on a single-laser machine or a CNC', () => {
    act(() => root.render(<LaserModuleRow />));
    expect(select()).toBeNull();
    expect(laserModuleFacts(useStore.getState().project.device)).toEqual([]);
    act(() => useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE));
    act(() =>
      useStore.setState((state) => ({
        project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
      })),
    );
    expect(select()).toBeNull();
  });
});
