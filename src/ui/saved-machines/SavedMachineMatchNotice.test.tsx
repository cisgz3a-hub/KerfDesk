/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LASER_SETTINGS,
  ROUTER_SETTINGS,
  everyFieldProfile,
  settingRows,
} from '../../__fixtures__/saved-machines';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { controllerFingerprintFromEvidence } from '../../core/saved-machines/controller-fingerprint';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  duplicateSavedMachine,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { resetStore } from '../state/test-helpers';
import { SavedMachineMatchNotice } from './SavedMachineMatchNotice';

function recorded(values: Readonly<Record<number, string>>) {
  return controllerFingerprintFromEvidence({
    firmware: 'grbl-v1.1',
    buildInfo: null,
    usb: null,
    settings: settingRows(values),
  });
}

const ROUTER = createSavedMachine({
  id: 'router',
  profile: everyFieldProfile(),
  machineKind: 'cnc',
  name: 'Shop 4040',
  controllerFingerprint: recorded(ROUTER_SETTINGS),
  now: 1,
});
const FALCON = createSavedMachine({
  id: 'falcon',
  profile: DEFAULT_DEVICE_PROFILE,
  machineKind: 'laser',
  name: 'Falcon',
  controllerFingerprint: recorded(LASER_SETTINGS),
  now: 1,
});

let host: HTMLDivElement;
let root: Root;

function installList(list: SavedMachineList): void {
  useSavedMachinesStore.setState({ list, persistFailed: false });
}

function connect(values: Readonly<Record<number, string>>, qualified = true): void {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: 4,
    controllerQualification: qualified
      ? { kind: 'qualified', epoch: 4, settings: 'verified' }
      : { kind: 'qualifying', epoch: 4, phase: 'settings-read' },
    detectedControllerKind: 'grbl-v1.1',
    activeControllerKind: 'grbl-v1.1',
    grblSettingsRows: settingRows(values),
  });
}

function notice(): Element | null {
  return host.querySelector('[aria-label="Saved machine recognised"]');
}

beforeEach(async () => {
  resetStore();
  installList(addSavedMachine(addSavedMachine(EMPTY_SAVED_MACHINE_LIST, ROUTER), FALCON));
  useStore.setState({ project: createProject(FALCON.profile) });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SavedMachineMatchNotice />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  useLaserStore.setState(initialLaserState());
  installList(EMPTY_SAVED_MACHINE_LIST);
});

describe('connect-time saved machine notice', () => {
  it('offers the one matching saved machine and switches only when asked', async () => {
    await act(async () => connect(ROUTER_SETTINGS));

    expect(notice()?.textContent).toBe(
      'This controller looks like your saved machine “Shop 4040” (matched 12 controller settings). The open project uses “Falcon”.SwitchNot now',
    );
    expect(useStore.getState().project.device).toEqual(FALCON.profile);

    const switchButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to Shop 4040"]',
    );
    await act(async () => switchButton?.click());

    expect(useStore.getState().project.device).toEqual(ROUTER.profile);
    expect(useStore.getState().project.machine?.kind).toBe('cnc');
    expect(notice()).toBeNull();
  });

  it('stays hidden until the controller settings have been read', async () => {
    await act(async () => connect(ROUTER_SETTINGS, false));

    expect(notice()).toBeNull();
  });

  it('stays hidden for the machine already open', async () => {
    await act(async () => connect(LASER_SETTINGS));

    expect(notice()).toBeNull();
  });

  it('stays hidden when two saved machines match the controller', async () => {
    const list = useSavedMachinesStore.getState().list;
    await act(async () => installList(duplicateSavedMachine(list, ROUTER.id, 'router-copy', 2)));
    await act(async () => connect(ROUTER_SETTINGS));

    expect(notice()).toBeNull();
  });

  it('Not now keeps the open machine for this connection', async () => {
    await act(async () => connect(ROUTER_SETTINGS));
    const notNow = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Not now',
    );

    await act(async () => notNow?.click());

    expect(notice()).toBeNull();
    expect(useStore.getState().project.device).toEqual(FALCON.profile);
  });
});
