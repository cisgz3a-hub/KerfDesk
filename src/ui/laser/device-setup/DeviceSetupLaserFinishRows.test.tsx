// ADR-483 (LightBurn gap LBG-M02): Machine Setup's laser step offers "After a
// job" with three choices. The default stores nothing, stay stores `stay`, and
// a bed position is typed in canvas coordinates. The harness runs the real
// Machine Setup reducer and the profile Save would write.
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import {
  deviceSetupReducer,
  initDeviceSetup,
  machineSetupProfile,
  type DeviceSetupState,
} from './device-setup-flow';
import { changeSetupInput, changeSetupSelect, setupSelect } from './device-setup-test-helpers';
import { DeviceSetupMachineStep } from './DeviceSetupMachineStep';

let host: HTMLDivElement;
let root: Root;
let latest: DeviceSetupState | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Harness(props: { readonly device: DeviceProfile }): JSX.Element {
  const [state, dispatch] = useReducer(deviceSetupReducer, null, () =>
    initDeviceSetup(props.device, null),
  );
  latest = state;
  return <DeviceSetupMachineStep state={state} dispatch={dispatch} />;
}

function render(device: DeviceProfile = DEFAULT_DEVICE_PROFILE): void {
  act(() => root.render(<Harness device={device} />));
}

function savedFinish(): DeviceProfile['laserFinishPosition'] {
  if (latest === null) throw new Error('harness not rendered');
  return machineSetupProfile(latest).laserFinishPosition;
}

function canvasField(axis: 'X' | 'Y'): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${axis} on the canvas"]`);
}

describe('Machine Setup: after a laser job (ADR-483)', () => {
  it('defaults to the work origin and stores nothing', () => {
    render();

    expect(setupSelect(host, 'After a job').value).toBe('origin');
    expect(setupSelect(host, 'After a job').selectedOptions[0]?.textContent).toBe(
      'Go to the work origin',
    );
    expect(canvasField('X')).toBeNull();
    expect(host.textContent).toContain('A Current Position job goes back to where it started.');
    expect(savedFinish()).toBeUndefined();
  });

  it('stores stay', async () => {
    render();

    await changeSetupSelect(host, 'After a job', 'stay');

    expect(savedFinish()).toEqual({ kind: 'stay' });
    expect(canvasField('X')).toBeNull();
  });

  it('starts a bed position on machine X0 Y0 and edits it in canvas coordinates', async () => {
    render();

    await changeSetupSelect(host, 'After a job', 'bed');
    // Machine X0 Y0 on the default front-left 400 x 400 bed is the front-left
    // corner, which the canvas shows at (0, 400); canvas 0, 0 is the back.
    expect(savedFinish()).toEqual({ kind: 'bed', xMm: 0, yMm: 400 });
    expect(host.textContent).toContain('Canvas coordinates, as on the rulers.');

    await changeSetupInput(host, 'X on the canvas', '25');
    await changeSetupInput(host, 'Y on the canvas', '40');

    expect(savedFinish()).toEqual({ kind: 'bed', xMm: 25, yMm: 40 });
    expect(canvasField('X')?.value).toBe('25');
    expect(canvasField('Y')?.value).toBe('40');
  });

  it('keeps a typed position on the bed', async () => {
    render({ ...DEFAULT_DEVICE_PROFILE, laserFinishPosition: { kind: 'bed', xMm: 5, yMm: 5 } });

    await changeSetupInput(host, 'X on the canvas', '99999');

    expect(savedFinish()).toEqual({ kind: 'bed', xMm: DEFAULT_DEVICE_PROFILE.bedWidth, yMm: 5 });
  });

  it('returns to the default by removing the stored value', async () => {
    render({ ...DEFAULT_DEVICE_PROFILE, laserFinishPosition: { kind: 'bed', xMm: 10, yMm: 0 } });
    expect(canvasField('X')?.value).toBe('10');

    await changeSetupSelect(host, 'After a job', 'origin');

    expect(savedFinish()).toBeUndefined();
    const profile = latest === null ? null : machineSetupProfile(latest);
    expect(JSON.parse(JSON.stringify(profile))).not.toHaveProperty('laserFinishPosition');
    expect(canvasField('X')).toBeNull();
  });
});
