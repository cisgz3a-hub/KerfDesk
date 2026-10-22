import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  FALCON_A1_PRO_GRBLHAL_PROFILE,
  FALCON_COMPATIBLE_PROFILE,
} from '../../../core/devices/falcon-profiles';
import { FALCON_A1_PRO_INFRARED_2W_MODULE } from '../../../core/devices/laser-modules';
import { LASER_DOT_LIGHT, type PositioningLight } from '../../../core/devices/positioning-light';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import { PositioningLightEditor } from './PositioningLightEditor';
import { DeviceSetupOptionsStep } from './DeviceSetupOptionsStep';
import {
  deviceSetupReducer,
  initDeviceSetup,
  machineSetupValidationIssues,
} from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
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

describe('positioning light setup', () => {
  it('requires explicit valid commands before the enabled draft can be saved', () => {
    let state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, { machine: LASER_MACHINE_CONFIG });
    const onChange = (positioningLight: PositioningLight | undefined): void => {
      state = deviceSetupReducer(state, { kind: 'edit', patch: { positioningLight } });
    };
    act(() => root.render(<PositioningLightEditor device={state.draft} onChange={onChange} />));
    const checkbox = host.querySelector('input')!;
    act(() => Simulate.change(checkbox, { target: { checked: true } } as never));
    expect(state.draft.positioningLight).toEqual({
      onCommand: '',
      offCommand: '',
      offsetXmm: 0,
      offsetYmm: 0,
    });
    expect(
      machineSetupValidationIssues(state).some((issue) =>
        issue.includes('Positioning light on command'),
      ),
    ).toBe(true);
    onChange({ onCommand: 'M8', offCommand: 'M9', offsetXmm: -12, offsetYmm: 7 });
    expect(machineSetupValidationIssues(state)).toEqual([]);
    onChange(undefined);
    expect(state.draft.positioningLight).toBeUndefined();
  });

  it('opens the pointer section when launched from the centre light button', () => {
    const state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, { machine: LASER_MACHINE_CONFIG });
    act(() =>
      root.render(<DeviceSetupOptionsStep state={state} dispatch={vi.fn()} openPositioningLight />),
    );
    const section = [...host.querySelectorAll('details')].find((details) =>
      details.querySelector('summary')?.textContent?.includes('Positioning LED'),
    );
    expect(section?.open).toBe(true);
  });

  it('explains Ruida file-only support and offers no live light configuration', () => {
    act(() =>
      root.render(
        <PositioningLightEditor
          device={{ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' }}
          onChange={vi.fn()}
        />,
      ),
    );
    expect(host.textContent).toContain('Live positioning and light control are unavailable');
    expect(host.querySelector('input')).toBeNull();
  });

  it('sets up the Falcon A1 Pro laser dot with one tick and nothing to type (ADR-664)', () => {
    let state = initDeviceSetup(FALCON_A1_PRO_GRBLHAL_PROFILE, null, {
      machine: LASER_MACHINE_CONFIG,
    });
    const onChange = (positioningLight: PositioningLight | undefined): void => {
      state = deviceSetupReducer(state, { kind: 'edit', patch: { positioningLight } });
    };
    act(() => root.render(<PositioningLightEditor device={state.draft} onChange={onChange} />));
    expect(host.textContent).toContain('Show where it will burn with the laser at low power');
    expect(host.textContent).not.toContain('Light on command');
    act(() =>
      Simulate.change(host.querySelector('input')!, { target: { checked: true } } as never),
    );
    expect(state.draft.positioningLight).toEqual(LASER_DOT_LIGHT);
    expect(machineSetupValidationIssues(state)).toEqual([]);

    act(() => root.render(<PositioningLightEditor device={state.draft} onChange={onChange} />));
    expect(host.textContent).toContain('This is the cutting laser.');
    expect(host.textContent).not.toContain('offset');
    const power = host.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(power.max).toBe('5');
    act(() => Simulate.change(power, { target: { valueAsNumber: 2 } } as never));
    expect(state.draft.positioningLight).toEqual({ ...LASER_DOT_LIGHT, powerPercent: 2 });
    act(() => Simulate.change(power, { target: { valueAsNumber: 8 } } as never));
    expect(machineSetupValidationIssues(state)).toContain(
      'Laser dot power must be above 0% and no more than 5%.',
    );
  });

  it('says the infrared module cannot show the dot', () => {
    const device = {
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      laserSubProfile: FALCON_A1_PRO_INFRARED_2W_MODULE,
      positioningLight: LASER_DOT_LIGHT,
    };
    act(() => root.render(<PositioningLightEditor device={device} onChange={vi.fn()} />));
    expect(host.textContent).toContain('1064 nm beam is invisible');
  });

  it('points a Falcon-compatible profile at the A1 Pro profile and refuses the dot there', () => {
    act(() =>
      root.render(<PositioningLightEditor device={FALCON_COMPATIBLE_PROFILE} onChange={vi.fn()} />),
    );
    expect(host.textContent).toContain('Choose its own machine profile');
    const state = initDeviceSetup(
      {
        ...FALCON_COMPATIBLE_PROFILE,
        positioningLight: LASER_DOT_LIGHT,
      },
      null,
      { machine: LASER_MACHINE_CONFIG },
    );
    expect(machineSetupValidationIssues(state)).toContain(
      'The laser dot needs the Creality Falcon A1 Pro machine profile.',
    );
  });
});
