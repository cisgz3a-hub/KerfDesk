// The per-machine Fire opt-in in Machine Setup (ADR-387): off by default like
// LightBurn's "Enable Laser Fire Button", with the power shown as the S word a
// press sends and a reason instead of a checkbox where Fire cannot exist.

import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import {
  deviceSetupReducer,
  initDeviceSetup,
  type DeviceSetupState,
} from './device-setup/device-setup-flow';
import { DeviceSetupMachineStep } from './device-setup/DeviceSetupMachineStep';
import { fireSetupSummary } from './FireControlRow';

let host: HTMLDivElement;
let root: Root;
let latest: DeviceSetupState | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Harness({ profile }: { readonly profile: DeviceProfile }): JSX.Element {
  const [state, dispatch] = useReducer(deviceSetupReducer, profile, (initial) =>
    initDeviceSetup(initial, null),
  );
  latest = state;
  return <DeviceSetupMachineStep state={state} dispatch={dispatch} highlight="fire" />;
}

function renderSetup(profile: DeviceProfile): void {
  act(() => root.render(<Harness profile={profile} />));
}

function draft(): DeviceProfile {
  if (latest === null) throw new Error('Machine Setup did not render.');
  return latest.draft;
}

function checkbox(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[aria-label="Enable Fire button"]');
}

function sValueText(): string | null | undefined {
  return host.querySelector('[aria-label="Fire power as the S value sent"]')?.textContent;
}

function editFirePower(value: string): void {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Fire power percent"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.focus();
    input.blur();
  });
}

describe('Enable Fire button in Machine Setup', () => {
  it('is off by default and opts a GRBL diode machine in with one click', () => {
    renderSetup(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(host.querySelector('details')?.open).toBe(true);
    expect(host.querySelector('summary')?.textContent).toContain('Fire: Off');
    expect(checkbox()?.checked).toBe(false);

    act(() => checkbox()?.click());

    expect(draft().fireControl).toEqual({ enabled: true, maxPowerPercent: 1 });
    expect(checkbox()?.checked).toBe(true);
    expect(host.querySelector('summary')?.textContent).toContain('Fire: On, 1% (S10)');
  });

  it('shows the S word a press sends and never keeps more than 5%', () => {
    renderSetup(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    act(() => checkbox()?.click());
    expect(sValueText()).toBe('% = S10 of S1000');

    editFirePower('2.5');
    expect(draft().fireControl).toEqual({ enabled: true, maxPowerPercent: 2.5 });
    expect(sValueText()).toBe('% = S25 of S1000');

    editFirePower('9');
    expect(draft().fireControl?.maxPowerPercent).toBe(5);
    expect(sValueText()).toBe('% = S50 of S1000');
  });

  it('warns when the Fire power rounds to S0 on the machine scale', () => {
    renderSetup({
      ...DEFAULT_DEVICE_PROFILE,
      maxPowerS: 255,
      fireControl: { enabled: true, maxPowerPercent: 0.1 },
    });

    expect(sValueText()).toBe('% = S0 of S255');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Fire power 0.1% rounds to S0 on this machine's S255 scale, which cannot light the beam.",
    );
  });

  it('keeps a Fire setting saved before Labs retired', () => {
    renderSetup({
      ...DEFAULT_DEVICE_PROFILE,
      capabilities: ['low-power-fire'],
      fireControl: { enabled: true, maxPowerPercent: 2 },
    });

    expect(checkbox()?.checked).toBe(true);
    expect(host.querySelector('summary')?.textContent).toContain('Fire: On, 2% (S20)');
  });

  it('says why a machine cannot offer Fire instead of showing the checkbox', () => {
    const cases: ReadonlyArray<readonly [Partial<DeviceProfile>, string]> = [
      [{ controllerKind: 'marlin' }, 'Marlin controllers have no Fire button'],
      [
        {
          laserSubProfile: {
            model: '60 W tube',
            technology: 'co2',
            focusMode: 'manual',
            airAssist: 'none',
          },
        },
        'invisible beam',
      ],
    ];
    for (const [patch, reason] of cases) {
      renderSetup({ ...DEFAULT_DEVICE_PROFILE, ...patch });

      expect(checkbox(), reason).toBeNull();
      expect(host.querySelector('[role="note"]')?.textContent, reason).toContain(reason);
      expect(host.querySelector('summary')?.textContent, reason).toContain('Fire: Not available');
      act(() => root.unmount());
      root = createRoot(host);
    }
  });
});

describe('fireSetupSummary', () => {
  it('names the state and the S word for every setup the review lists', () => {
    expect(fireSetupSummary(DEFAULT_DEVICE_PROFILE)).toBe('Off');
    expect(
      fireSetupSummary({
        ...DEFAULT_DEVICE_PROFILE,
        fireControl: { enabled: true, maxPowerPercent: 1.25 },
      }),
    ).toBe('On, 1.25% (S13)');
    expect(fireSetupSummary({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin' })).toBe(
      'Not available',
    );
  });
});
