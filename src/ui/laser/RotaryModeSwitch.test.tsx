import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { RotarySetup } from '../../core/devices';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { RotaryModeSwitch } from './RotaryModeSwitch';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MEASURED_ROLLER: RotarySetup = {
  enabled: false,
  type: 'roller',
  mmPerRotation: 40,
  objectDiameterMm: 60,
  rollerDiameterMm: 25,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
});

function setRotary(rotary: RotarySetup | undefined): void {
  const project = useStore.getState().project;
  const { rotary: _previous, ...device } = project.device;
  useStore.setState({
    project: { ...project, device: rotary === undefined ? device : { ...device, rotary } },
  });
}

function renderSwitch(): void {
  act(() => root.render(<RotaryModeSwitch />));
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

describe('RotaryModeSwitch', () => {
  it('stays out of the way until a rotary is set up, and on CNC projects', () => {
    setRotary(undefined);
    renderSwitch();
    expect(host.textContent).toBe('');
    act(() => setRotary(MEASURED_ROLLER));
    expect(host.textContent).toContain('Rotary');
    const project = useStore.getState().project;
    act(() => useStore.setState({ project: { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } }));
    expect(host.textContent).toBe('');
  });

  it('switches the profile rotary on and off and names the attachment', () => {
    setRotary(MEASURED_ROLLER);
    renderSwitch();
    const rotary = button('Rotary');
    expect(rotary.getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('Off · Roller, Ø60 mm (rollers Ø25 mm)');

    act(() => rotary.click());
    expect(useStore.getState().project.device.rotary).toEqual({
      ...MEASURED_ROLLER,
      enabled: true,
    });
    expect(button('Rotary').getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).not.toContain('Off ·');
    expect(button('Rotary').title).toContain('Y ×0.51, one revolution = 96 machine mm');

    act(() => button('Rotary').click());
    expect(useStore.getState().project.device.rotary).toEqual(MEASURED_ROLLER);
  });

  it('cannot switch while a job or motion owns the machine', () => {
    setRotary(MEASURED_ROLLER);
    useLaserStore.setState({
      motionOperation: {
        kind: 'jog',
        operationId: Symbol('jog'),
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });
    renderSwitch();
    expect(button('Rotary').disabled).toBe(true);
  });

  it('opens Rotary Setup from the switch row', () => {
    setRotary(MEASURED_ROLLER);
    renderSwitch();
    act(() => button('Setup…').click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Rotary Setup');
    act(() => button('Cancel').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens Rotary Setup instead of enabling unusable measurements', () => {
    setRotary({ ...MEASURED_ROLLER, objectDiameterMm: 0 });
    renderSwitch();
    act(() => button('Rotary').click());
    expect(useStore.getState().project.device.rotary?.enabled).toBe(false);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Rotary Setup');
  });
});
