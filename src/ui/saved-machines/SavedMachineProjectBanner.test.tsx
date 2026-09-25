/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  findSavedMachine,
  removeSavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { ActiveMachineBar } from './ActiveMachineBar';
import { SavedMachineProjectBanner } from './SavedMachineProjectBanner';

const SAVED = createSavedMachine({
  id: 'shop-laser',
  profile: { ...DEFAULT_DEVICE_PROFILE, name: 'Shop laser' },
  machineKind: 'laser',
  now: 1,
});

let host: HTMLDivElement;
let root: Root;

function savedProfile(): DeviceProfile {
  const machine = findSavedMachine(useSavedMachinesStore.getState().list, SAVED.id);
  if (machine === undefined) throw new Error('saved machine missing');
  return machine.profile;
}

/** Open a project whose copy of the saved machine was changed elsewhere. */
function openEditedCopy(patch: Partial<DeviceProfile>): void {
  useStore.getState().setProject(createProject({ ...SAVED.profile, ...patch }));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`no ${label} button`);
  return found;
}

async function render(): Promise<void> {
  await act(async () =>
    root.render(
      <>
        <ActiveMachineBar />
        <SavedMachineProjectBanner />
      </>,
    ),
  );
}

function banner(): Element | null {
  return host.querySelector('[aria-label="Saved machine differs"]');
}

beforeEach(() => {
  resetStore();
  useStore.setState({ project: createProject(SAVED.profile) });
  useSavedMachinesStore.setState({
    list: addSavedMachine(EMPTY_SAVED_MACHINE_LIST, SAVED),
    persistFailed: false,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
});

describe('a project that names a saved machine', () => {
  it('shows which saved machine it is and stays quiet while the copy matches', async () => {
    openEditedCopy({ name: 'Renamed in the project' });
    await render();

    expect(host.querySelector('[aria-label="Active machine"]')?.textContent).toContain(
      'Saved as “Shop laser”',
    );
    expect(banner()).toBeNull();
  });

  it('names the differing settings and offers both directions', async () => {
    openEditedCopy({
      maxPowerS: 500,
      noGoZones: [{ id: 'clamp', name: 'Clamp', enabled: true, x: 1, y: 1, width: 5, height: 5 }],
    });
    await render();

    expect(banner()?.textContent).toContain(
      'differs from your saved machine in Power and laser mode, No-go zones',
    );
    expect(button('Update saved machine')).toBeDefined();
    expect(button('Use saved settings')).toBeDefined();
    expect(button('Keep project copy')).toBeDefined();
  });

  it('Update saved machine writes the project copy into My machines', async () => {
    openEditedCopy({ maxPowerS: 500 });
    await render();

    await act(async () => button('Update saved machine').click());

    expect(savedProfile().maxPowerS).toBe(500);
    expect(useStore.getState().project.device.maxPowerS).toBe(500);
    expect(banner()).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Updated “Shop laser” from this project.',
    );
  });

  it('Use saved settings replaces the project copy in one undoable change', async () => {
    openEditedCopy({ maxPowerS: 500 });
    await render();

    await act(async () => button('Use saved settings').click());

    expect(useStore.getState().project.device).toEqual(SAVED.profile);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(savedProfile().maxPowerS).toBe(DEFAULT_DEVICE_PROFILE.maxPowerS);
    expect(banner()).toBeNull();
  });

  it('Keep project copy leaves both unchanged', async () => {
    openEditedCopy({ maxPowerS: 500 });
    await render();

    await act(async () => button('Keep project copy').click());

    expect(banner()).toBeNull();
    expect(useStore.getState().project.device.maxPowerS).toBe(500);
    expect(savedProfile()).toEqual(SAVED.profile);
  });

  it('waits for the opened-project machine question and ignores a removed entry', async () => {
    useStore.setState({ project: createProject({ ...DEFAULT_DEVICE_PROFILE, bedWidth: 200 }) });
    openEditedCopy({ maxPowerS: 500 });
    await render();

    expect(useStore.getState().projectBedReconciliation).not.toBeNull();
    expect(banner()).toBeNull();

    await act(async () => useStore.getState().acceptOpenedProjectMachine());
    expect(banner()).not.toBeNull();

    await act(async () =>
      useSavedMachinesStore.setState({
        list: removeSavedMachine(useSavedMachinesStore.getState().list, SAVED.id),
      }),
    );
    expect(banner()).toBeNull();
    expect(host.textContent).toContain('Not in My machines');
  });
});
