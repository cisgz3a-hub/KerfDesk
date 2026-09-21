import { act, useReducer, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { DeviceSetupControls } from './device-setup/DeviceSetupControls';
import { DeviceSetupMachineCapability } from './device-setup/DeviceSetupMachineCapability';
import { DeviceSetupProfilePicker } from './device-setup/DeviceSetupProfilePicker';
import { MachineSetupDialogHost } from './device-setup/MachineSetupDialogHost';
import { deviceSetupReducer, initDeviceSetup } from './device-setup/device-setup-flow';
import { useMachineSetupDialogStore } from './device-setup/machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const original = useLaserStore.getState();
const adapter: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useMachineSetupDialogStore.getState().close();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(original, true);
  useMachineSetupDialogStore.getState().close();
  resetStore();
});
function render(node: ReactNode): void {
  act(() => root.render(<PlatformProvider adapter={adapter}>{node}</PlatformProvider>));
}
function button(text: string): HTMLButtonElement {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button ${text}`);
  return node;
}
function ariaButton(label: string): HTMLButtonElement {
  const node = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing button ${label}`);
  return node;
}
function openSetup(): void {
  render(
    <>
      <DeviceSetupControls />
      <MachineSetupDialogHost />
    </>,
  );
  act(() => button('Machine Setup').click());
}
async function roundTripDisclosure(title: string): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find((item) =>
    item.textContent?.startsWith(title),
  );
  const details = summary?.parentElement;
  if (!(details instanceof HTMLDetailsElement)) throw new Error(`Missing disclosure ${title}`);
  const initial = details.open;
  await act(async () => {
    summary!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(details.open, title).toBe(!initial);
  await act(async () => {
    summary!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(details.open, title).toBe(initial);
}

describe('three-stage Machine Setup integration audit', () => {
  it('stepper and footer retain a draft through Back, save once, and cancel later edits without controller calls', async () => {
    const home = vi.fn(async () => undefined);
    const writeGrblSetting = vi.fn(async () => undefined);
    useLaserStore.setState({ home, writeGrblSetting });
    openSetup();
    expect(host.querySelectorAll('[aria-label="Machine Setup steps"] button')).toHaveLength(3);
    act(() => button('Check essentials').click());
    expect(host.querySelector('fieldset[aria-label="Essentials"]')).not.toBeNull();
    const name = host.querySelector<HTMLInputElement>('[aria-label="Device name"]')!;
    act(() => {
      name.value = 'Three-stage audit machine';
      Simulate.change(name);
    });
    act(() => button('Back').click());
    expect(host.querySelector('fieldset[aria-label="Machine"]')).not.toBeNull();
    act(() => ariaButton('Go to step 2: Essentials').click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Device name"]')?.value).toBe(
      'Three-stage audit machine',
    );
    act(() => button('Review setup').click());
    expect(host.querySelector('fieldset[aria-label="Review & save"]')).not.toBeNull();
    act(() => ariaButton('Go to step 1: Machine').click());
    act(() => ariaButton('Go to step 3: Review & save').click());
    const undoCount = useStore.getState().undoStack.length;
    await act(async () => button('Save machine setup').click());
    expect(useStore.getState().project.device.name).toBe('Three-stage audit machine');
    expect(useStore.getState().undoStack).toHaveLength(undoCount + 1);
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
    act(() => button('Machine Setup').click());
    act(() => button('Check essentials').click());
    const laterName = host.querySelector<HTMLInputElement>('[aria-label="Device name"]')!;
    act(() => {
      laterName.value = 'Discard this later edit';
      Simulate.change(laterName);
    });
    await act(async () => button('Cancel without saving').click());
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
    expect(useStore.getState().project.device.name).toBe('Three-stage audit machine');
    expect(useStore.getState().undoStack).toHaveLength(undoCount + 1);
    expect(home).not.toHaveBeenCalled();
    expect(writeGrblSetting).not.toHaveBeenCalled();
  });

  it('all new stage and review disclosures open and close without changing the hybrid draft or live project', async () => {
    useStore.getState().updateDeviceProfile({ capabilities: ['laser-output', 'cnc-output'] });
    useStore.getState().setMachineKind('cnc');
    const project = useStore.getState().project;
    openSetup();
    for (const title of ['Controller and connection settings', 'Connect and detect'])
      await roundTripDisclosure(title);
    act(() => ariaButton('Go to step 2: Essentials').click());
    for (const title of [
      'Travel speeds',
      'Air assist and test fire',
      'CNC job setup',
      'Accessories and calibration',
    ])
      await roundTripDisclosure(title);
    act(() => ariaButton('Go to step 3: Review & save').click());
    for (const title of ['Controller settings', 'Hardware commissioning checklist'])
      await roundTripDisclosure(title);
    expect(useStore.getState().project).toBe(project);
    expect(host.textContent).toContain('No writes queued');
    expect(host.querySelector('fieldset[aria-label="Review & save"]')).not.toBeNull();
  });

  it('all machine capability and active-toolhead radios update only the real setup reducer', () => {
    let snapshot = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null);
    function Harness(): JSX.Element {
      const [state, dispatch] = useReducer(deviceSetupReducer, snapshot);
      snapshot = state;
      return <DeviceSetupMachineCapability state={state} dispatch={dispatch} />;
    }
    const project = useStore.getState().project;
    render(<Harness />);
    for (const [label, kinds] of [
      ['CNC only', ['cnc']],
      ['Laser only', ['laser']],
      ['Laser + CNC', ['laser', 'cnc']],
    ] as const) {
      const radio = [
        ...host.querySelectorAll<HTMLInputElement>('input[name="machine-capability"]'),
      ].find((item) => item.getAttribute('aria-label') === label);
      expect(radio, `Missing ${label}: ${host.innerHTML}`).toBeDefined();
      act(() => radio!.click());
      expect(radio!.checked).toBe(true);
      expect(snapshot.machineKinds).toEqual(kinds);
    }
    const radios = [
      ...host.querySelectorAll<HTMLInputElement>('input[name="active-machine-kind"]'),
    ];
    expect(radios).toHaveLength(2);
    act(() => radios[1]!.click());
    expect(snapshot.machineKind).toBe('cnc');
    act(() => radios[0]!.click());
    expect(snapshot.machineKind).toBe('laser');
    expect(useStore.getState().project).toBe(project);
  });

  it('Browse all and profile details preserve the draft, while Use profile changes only the chosen draft profile', async () => {
    let snapshot = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null);
    function Harness(): JSX.Element {
      const [state, dispatch] = useReducer(deviceSetupReducer, snapshot);
      snapshot = state;
      return <DeviceSetupProfilePicker state={state} dispatch={dispatch} />;
    }
    const project = useStore.getState().project;
    render(<Harness />);
    expect(host.querySelectorAll('article.lf-setup-profile')).toHaveLength(2);
    const draft = snapshot.draft;
    const browse = [...host.querySelectorAll('button')].find((item) =>
      item.textContent?.startsWith('Browse all'),
    )!;
    act(() => browse.click());
    expect(host.querySelectorAll('article.lf-setup-profile').length).toBeGreaterThan(2);
    expect(button('Show fewer profiles').getAttribute('aria-expanded')).toBe('true');
    for (const summary of host.querySelectorAll<HTMLElement>('summary')) {
      const details = summary.parentElement as HTMLDetailsElement;
      act(() => summary.click());
      expect(details.open).toBe(true);
      act(() => summary.click());
      expect(details.open).toBe(false);
    }
    expect(snapshot.draft).toBe(draft);
    const use = host.querySelector<HTMLButtonElement>('button[aria-label^="Use "]')!;
    const chosenName = use.closest('article')?.querySelector('strong')?.textContent;
    act(() => use.click());
    expect(snapshot.draft.name).toBe(chosenName);
    expect(
      host.querySelector<HTMLButtonElement>(`button[aria-label="Selected ${chosenName}"]`)
        ?.disabled,
    ).toBe(true);
    act(() => button('Show fewer profiles').click());
    expect(host.querySelectorAll('article.lf-setup-profile')).toHaveLength(2);
    expect(useStore.getState().project).toBe(project);
  });
});
