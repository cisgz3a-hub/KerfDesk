// Profile import on the Machine stage asks before it replaces values someone
// set, as a list choice does (ADR-637 Amendment 3, rolling audit v4 H4-P2-1).

import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceProfile } from '../../../core/devices';
import { ORTUR_LASER_MASTER_3_PROFILES } from '../../../core/devices/brand-laser-profiles';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { withSavedCameraModel } from '../../../core/camera/model/saved-cameras';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from '../../../io/machine-profile';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useToastStore } from '../../state/toast-store';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { deviceSetupReducer, initDeviceSetup, type DeviceSetupState } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORTUR = ORTUR_LASER_MASTER_3_PROFILES[0] as DeviceProfile;
const CLAMP = { id: 'clamp', name: 'Clamp', enabled: true, x: 0, y: 0, width: 40, height: 40 };
const TUNED: DeviceProfile = {
  ...ORTUR,
  noGoZones: [CLAMP],
  ...withSavedCameraModel(ORTUR, savedCameraModel()),
  scanningOffsets: [
    { speedMmPerMin: 3000, offsetMm: 0.1 },
    { speedMmPerMin: 6000, offsetMm: 0.2 },
  ],
  scanOffsetCalibrationStatus: 'verified',
  savedPositions: [{ name: 'Jig corner', frame: 'bed', xMm: 12, yMm: 34 }],
};

const LBDEV = JSON.stringify({
  DeviceList: [
    {
      DisplayName: 'Ortur LM3 (vendor file)',
      Name: 'GRBL',
      Width: 400,
      Height: 380,
      MirrorX: false,
      MirrorY: false,
      Settings: { S_Scale: 1000, BaudRate: 115200 },
    },
  ],
});
// The operator's own backup of the untuned machine.
const BACKUP = serializeMachineProfileDocument({
  format: MACHINE_PROFILE_FORMAT,
  schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
  profile: { ...ORTUR, name: 'Ortur backup' },
  source: { kind: 'custom', label: 'Backup' },
  reviewNotes: [],
});

let host: HTMLDivElement;
let root: Root;
let snapshot: DeviceSetupState;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useToastStore.setState({ toasts: [] });
});

function platform(name: string, text: string): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async () => [
      { name, text: async () => text } as unknown as File,
    ]) as unknown as PlatformAdapter['pickFilesForOpen'],
    pickFileForSave: vi.fn(async () => null),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
}

function render(initial: DeviceProfile, adapter: PlatformAdapter): void {
  snapshot = initDeviceSetup(initial, null, { machine: LASER_MACHINE_CONFIG });
  function Harness(): JSX.Element {
    const [state, dispatch] = useReducer(deviceSetupReducer, snapshot);
    snapshot = state;
    return <DeviceSetupIdentifyStep state={state} dispatch={dispatch} />;
  }
  act(() =>
    root.render(
      <PlatformProvider adapter={adapter}>
        <Harness />
      </PlatformProvider>,
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (match === undefined) throw new Error(`Button missing: ${label}`);
  return match;
}

async function importFile(label: string): Promise<void> {
  await act(async () => button(label).click());
  act(() => button('Apply imported profile').click());
}

function question(): string | null {
  return host.querySelector('.lf-setup-picker-confirm')?.textContent ?? null;
}

describe('profile import on the Machine stage', () => {
  it('asks before a LightBurn device file replaces the zones and calibrations', async () => {
    render(TUNED, platform('ortur.lbdev', LBDEV));
    await importFile('Import LightBurn .lbdev');
    expect(question()).toContain('Replace this machine’s settings?');
    expect(question()).toContain(
      'Importing Ortur LM3 (vendor file) replaces the no-go zones, scan-offset calibration, camera calibration and saved positions',
    );
    expect(snapshot.draft.noGoZones).toEqual([CLAMP]);

    act(() => button('Keep current settings').click());
    expect(question()).toBeNull();
    expect(snapshot.draft).toMatchObject({ name: TUNED.name, noGoZones: [CLAMP] });
    expect(snapshot.draft.cameraModel).toEqual(TUNED.cameraModel);
    expect(useToastStore.getState().toasts).toEqual([]);

    act(() => button('Apply imported profile').click());
    act(() => button('Replace settings').click());
    expect(snapshot.draft).toMatchObject({ name: 'Ortur LM3 (vendor file)', noGoZones: [] });
    expect(question()).toBeNull();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Machine profile applied.',
    ]);
  });

  it('asks before a KerfDesk profile backup replaces them too', async () => {
    render(TUNED, platform('ortur.lfmachine.json', BACKUP));
    await importFile('Import KerfDesk profile');
    expect(question()).toContain(
      'Importing Ortur backup replaces the no-go zones, scan-offset calibration, camera calibration and saved positions',
    );
    expect(snapshot.draft.scanningOffsets).toHaveLength(2);
    act(() => button('Replace settings').click());
    expect(snapshot.draft).toMatchObject({ name: 'Ortur backup', noGoZones: [] });
    expect(snapshot.draft.scanningOffsets).toEqual([]);
  });

  it('applies at once when the draft holds nothing someone set', async () => {
    render(ORTUR, platform('ortur.lbdev', LBDEV));
    await importFile('Import LightBurn .lbdev');
    expect(question()).toBeNull();
    expect(snapshot.draft.name).toBe('Ortur LM3 (vendor file)');
  });
});
