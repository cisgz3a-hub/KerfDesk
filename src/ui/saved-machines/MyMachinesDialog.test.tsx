/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  findSavedMachine,
  type SavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { restoreSavedMachineList } from '../state/saved-machines-persistence';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { resetStore } from '../state/test-helpers';
import { MyMachinesDialog } from './MyMachinesDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FALCON = createSavedMachine({
  id: 'falcon',
  profile: FALCON_A1_PRO_GRBLHAL_PROFILE,
  machineKind: 'laser',
  name: 'Falcon',
  now: 1,
});
const BENCH = createSavedMachine({
  id: 'bench',
  profile: DEFAULT_DEVICE_PROFILE,
  machineKind: 'laser',
  name: 'Bench laser',
  now: 1,
});

let host: HTMLDivElement;
let root: Root;
let written: string | null;
let fileToOpen: string | null;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () =>
    fileToOpen === null
      ? []
      : [{ name: 'machine.lfmachine.json', text: async () => fileToOpen ?? '' }],
  pickFileForSave: async () => ({
    displayName: 'machine.lfmachine.json',
    write: async (data) => {
      written = typeof data === 'string' ? data : await data.text();
    },
  }),
  serial: { isSupported: () => false, requestPort: async () => null },
};

function installList(...machines: ReadonlyArray<SavedMachine>): void {
  const list = machines.reduce(addSavedMachine, EMPTY_SAVED_MACHINE_LIST);
  useSavedMachinesStore.setState({ list, persistFailed: false });
}

function savedList() {
  return useSavedMachinesStore.getState().list;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`no ${label} button`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => button(label).click());
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function statusText(): string {
  return host.querySelector('p[role="status"]')?.textContent ?? '';
}

beforeEach(async () => {
  resetStore();
  localStorage.clear();
  written = null;
  fileToOpen = null;
  useStore.setState({ project: createProject({ ...DEFAULT_DEVICE_PROFILE, name: 'Shop laser' }) });
  installList(FALCON, BENCH);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform}>
        <MyMachinesDialog onClose={() => undefined} />
      </PlatformProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  localStorage.clear();
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
});

describe('My machines dialog', () => {
  it('saves the open machine, links the project and stores the list on this workstation', async () => {
    await press('Save current machine');

    const device = useStore.getState().project.device;
    const saved = findSavedMachine(savedList(), device.savedMachineId);
    expect(saved?.name).toBe('Shop laser');
    expect(saved?.profile).toEqual(device);
    expect(statusText()).toBe('Saved “Shop laser” to My machines. This project now uses it.');
    expect(button('Switch to Shop laser').disabled).toBe(true);
    expect(host.textContent).toContain('In this project');
    expect(button('Save changes to saved machine')).toBeDefined();
    expect(restoreSavedMachineList(localStorage)).toEqual(savedList());
  });

  it('switches the open project to a saved machine and asks for a new Frame', async () => {
    await press('Switch to Falcon');

    expect(useStore.getState().project.device).toEqual(FALCON.profile);
    expect(statusText()).toBe('Switched to “Falcon”. Frame the job again before Start.');
    expect(button('Switch to Falcon').disabled).toBe(true);
  });

  it('renames in place and refuses a name already in use', async () => {
    await press('Rename Falcon');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="New name for Falcon"]');
    if (input === null) throw new Error('no rename field');

    await type(input, 'bench LASER');
    await press('Save name');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Another saved machine is already called “Bench laser”.',
    );

    await type(input, 'Falcon A1 Pro');
    await press('Save name');
    expect(findSavedMachine(savedList(), 'falcon')?.name).toBe('Falcon A1 Pro');
    expect(findSavedMachine(savedList(), 'falcon')?.profile.name).toBe('Falcon A1 Pro');
  });

  it('duplicates, sets the default and removes only after an in-page confirmation', async () => {
    await press('Duplicate Falcon');
    expect(savedList().machines.map((machine) => machine.name)).toContain('Falcon (Duplicate)');

    await press('Set Falcon as default');
    expect(savedList().defaultMachineId).toBe('falcon');
    expect(button('Clear default Falcon')).toBeDefined();

    await press('Remove Falcon');
    expect(host.querySelector('[aria-label="Confirm removing Falcon"]')).not.toBeNull();
    expect(findSavedMachine(savedList(), 'falcon')).toBeDefined();
    await press('Keep');
    expect(host.querySelector('[aria-label="Confirm removing Falcon"]')).toBeNull();

    await press('Remove Falcon');
    await press('Remove machine');
    expect(findSavedMachine(savedList(), 'falcon')).toBeUndefined();
    expect(savedList().defaultMachineId).toBeNull();
    expect(statusText()).toContain('Projects that used it keep their own copy.');
  });

  it('exports a machine to a file that imports back as a separate copy', async () => {
    await press('Export Bench laser');
    expect(written).toContain('"format": "laserforge-machine-profile"');

    fileToOpen = written;
    await press('Import…');

    const imported = savedList().machines.find((machine) => machine.name === 'Bench laser 2');
    expect(imported).toBeDefined();
    expect(imported?.id).not.toBe('bench');
    expect(imported?.profile).toEqual({
      ...BENCH.profile,
      name: 'Bench laser 2',
      savedMachineId: imported?.id,
    });
    // The file's own review notes are repeated, as Machine Setup's import does.
    expect(statusText()).toMatch(/^Imported “Bench laser 2”\. Review: /);
  });

  it('reports a file that is not a machine profile', async () => {
    fileToOpen = '{"format":"laserforge-project"}';
    await press('Import…');

    expect(statusText()).toBe('Import failed: wrong machine profile format');
    expect(savedList().machines).toHaveLength(2);
  });
});
