// The machine list against a draft someone has already shaped (ADR-637
// Amendment 1): the chosen machine's details describe the draft, a choice that
// would throw away tuned values asks first, and the "not listed" firmware
// choice starts from that firmware's own starter.

import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import { ORTUR_LASER_MASTER_3_PROFILES } from '../../../core/devices/brand-laser-profiles';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import { DeviceSetupMachinePicker } from './DeviceSetupMachinePicker';
import { deviceSetupReducer, initDeviceSetup, type DeviceSetupState } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORTUR = ORTUR_LASER_MASTER_3_PROFILES[0] as DeviceProfile;
const TUNED_ORTUR: DeviceProfile = {
  ...ORTUR,
  maxFeed: ORTUR.maxFeed + 1500,
  noGoZones: [{ id: 'clamp', name: 'Clamp', enabled: true, x: 0, y: 0, width: 40, height: 40 }],
};

let host: HTMLDivElement;
let root: Root;
let snapshot: DeviceSetupState;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderPicker(initial: DeviceSetupState): void {
  snapshot = initial;
  function Harness(): JSX.Element {
    const [state, dispatch] = useReducer(deviceSetupReducer, snapshot);
    snapshot = state;
    return <DeviceSetupMachinePicker state={state} dispatch={dispatch} />;
  }
  act(() => root.render(<Harness />));
}

function laserSetup(profile: DeviceProfile): DeviceSetupState {
  return initDeviceSetup(profile, null, { machine: LASER_MACHINE_CONFIG });
}

function radio(label: string): HTMLInputElement {
  const match = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (match === null) throw new Error(`Radio missing: ${label}`);
  return match;
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (match === undefined) throw new Error(`Button missing: ${label}`);
  return match;
}

function details(): string {
  return host.querySelector('section[aria-label="Chosen machine"]')?.textContent ?? '';
}

describe('chosen machine details', () => {
  it('describe the draft, and let a listed machine set up as another type be corrected', () => {
    // An Ortur saved as a CNC machine by an earlier setup.
    const capabilities = (ORTUR.capabilities ?? []).filter((item) => item !== 'laser-output');
    renderPicker(
      initDeviceSetup(
        { ...ORTUR, capabilities: [...capabilities, 'cnc-output'], bedWidth: 380 },
        null,
        {
          machine: LASER_MACHINE_CONFIG,
        },
      ),
    );
    expect(snapshot.machineKinds).toEqual(['cnc']);
    expect(details()).toContain('380 × 400 mm');
    expect(details()).toContain('CNC');
    expect(details()).not.toMatch(/· Laser ·/);
    act(() => radio('Laser only').click());
    expect(snapshot.machineKinds).toEqual(['laser']);
    expect(details()).toContain('Laser');
    // Once the type matches the listed machine, the question goes away.
    expect(host.querySelector('input[aria-label="Laser only"]')).toBeNull();
  });
});

describe('choosing over tuned values', () => {
  it('asks before a CNC preset replaces a tuned listed laser, and names what goes', () => {
    renderPicker(laserSetup(TUNED_ORTUR));
    const genmitsu = radio('Use Genmitsu 3018-PRO');
    act(() => genmitsu.click());
    expect(snapshot.draft).toEqual(TUNED_ORTUR);
    expect(genmitsu.checked).toBe(false);
    const prompt = host.querySelector('.lf-setup-picker-confirm')?.textContent ?? '';
    expect(prompt).toContain('Genmitsu 3018-PRO');
    expect(prompt).toContain('max feed');
    expect(prompt).toContain('no-go zones');

    act(() => button('Keep current settings').click());
    expect(host.querySelector('.lf-setup-picker-confirm')).toBeNull();
    expect(snapshot.draft).toEqual(TUNED_ORTUR);

    act(() => radio('Use Genmitsu 3018-PRO').click());
    act(() => button('Replace settings').click());
    expect(snapshot.machineKinds).toEqual(['cnc']);
    expect(snapshot.draft.noGoZones).toEqual([]);
    expect(radio('Use Genmitsu 3018-PRO').checked).toBe(true);
  });

  it('asks before "My machine isn’t listed" or another listed laser replaces them', () => {
    renderPicker(laserSetup(TUNED_ORTUR));
    act(() => radio('My machine isn’t listed').click());
    expect(snapshot.draft).toEqual(TUNED_ORTUR);
    expect(host.querySelector('.lf-setup-picker-confirm')?.textContent).toContain('max feed');
    // Arrowing on to the next row moves the question with it; nothing is applied.
    act(() => radio(`Use ${ORTUR_LASER_MASTER_3_PROFILES[1]?.name ?? ''}`).click());
    expect(snapshot.draft).toEqual(TUNED_ORTUR);
    expect(host.querySelector('.lf-setup-picker-confirm')?.textContent).toContain(
      ORTUR_LASER_MASTER_3_PROFILES[1]?.name ?? '',
    );
  });

  it('applies at once when nothing tuned would be lost', () => {
    renderPicker(laserSetup(ORTUR));
    act(() => radio('Use Genmitsu 3018-PRO').click());
    expect(host.querySelector('.lf-setup-picker-confirm')).toBeNull();
    expect(snapshot.machineKinds).toEqual(['cnc']);
  });
});

describe('My machine isn’t listed firmware', () => {
  it('starts an untouched machine from the chosen firmware’s own starter', () => {
    renderPicker(laserSetup(DEFAULT_DEVICE_PROFILE));
    act(() => radio('My machine isn’t listed').click());
    changeFirmware('ruida');
    expect(snapshot.draft).toMatchObject({
      name: 'My machine',
      controllerKind: 'ruida',
      origin: 'rear-right',
      bedWidth: 900,
      bedHeight: 600,
    });
    expect(snapshot.machineKinds).toEqual(['laser']);

    changeFirmware('marlin');
    expect(snapshot.draft).toMatchObject({ controllerKind: 'marlin', bedWidth: 300 });
    expect(snapshot.draft.capabilities).not.toContain('wcs');
  });

  it('keeps a typed work area and the chosen type', () => {
    renderPicker(laserSetup(DEFAULT_DEVICE_PROFILE));
    act(() => radio('My machine isn’t listed').click());
    act(() => radio('CNC only').click());
    commitNumber('Work area width (mm)', '610');
    changeFirmware('grblhal');
    expect(snapshot.draft).toMatchObject({ controllerKind: 'grblhal', bedWidth: 610 });
    expect(snapshot.draft.rxBufferBytes).toBe(1024);
    expect(snapshot.machineKinds).toEqual(['cnc']);
  });

  it('changes only the firmware once other values are the operator’s', () => {
    renderPicker(laserSetup({ ...DEFAULT_DEVICE_PROFILE, name: 'Shop laser', maxFeed: 9000 }));
    changeFirmware('ruida');
    expect(snapshot.draft).toMatchObject({
      controllerKind: 'ruida',
      origin: 'front-left',
      maxFeed: 9000,
      bedWidth: 400,
    });
  });
});

function changeFirmware(kind: string): void {
  const field = host.querySelector<HTMLSelectElement>('select[aria-label="Firmware"]');
  if (field === null) throw new Error('Firmware select missing');
  act(() => {
    field.value = kind;
    Simulate.change(field);
  });
}

function commitNumber(label: string, value: string): void {
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (field === null) throw new Error(`Number field missing: ${label}`);
  act(() => {
    field.value = value;
    Simulate.change(field);
  });
  act(() => {
    Simulate.blur(field);
  });
}
