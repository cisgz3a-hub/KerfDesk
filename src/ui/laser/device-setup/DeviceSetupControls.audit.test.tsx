import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, DEFAULT_ROTARY_SETUP } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, DEFAULT_CNC_TILING } from '../../../core/scene';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupCncJobStep } from './DeviceSetupCncJobStep';
import { DeviceSetupCncPreset } from './DeviceSetupCncPreset';
import { DeviceSetupCncProfiles } from './DeviceSetupCncProfiles';
import { DeviceSetupCncTilingFields } from './DeviceSetupCncTilingFields';
import { DeviceSetupConfirmStep } from './DeviceSetupConfirmStep';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { DeviceSetupControls } from './DeviceSetupControls';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { DeviceSetupOptionsStep } from './DeviceSetupOptionsStep';
import { DeviceSetupReviewStep } from './DeviceSetupReviewStep';
import { DeviceSetupRotaryFields } from './DeviceSetupRotaryFields';
import { initDeviceSetup } from './device-setup-flow';
import { useMachineSetupDialogStore } from './machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const original = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;
const platform = {
  id: 'mock' as const,
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => true, requestPort: async () => null },
};
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
  useLaserStore.setState(original, true);
  resetStore();
  useMachineSetupDialogStore.getState().close();
});
function render(node: ReactNode): void {
  act(() => root.render(<PlatformProvider adapter={platform}>{node}</PlatformProvider>));
}
function button(text: string): HTMLButtonElement {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
function checkbox(label: string): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing checkbox: ${label}`);
  return node;
}

describe('Setup control audit', () => {
  it('audit read-only checks dispatch identity and settings without firmware or motion writes', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    const readMachineSettings = vi.fn(async () => undefined);
    const writeGrblSetting = vi.fn(async () => undefined);
    const home = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      sendConsoleCommand,
      readMachineSettings,
      writeGrblSetting,
      home,
    });
    render(
      <DeviceSetupConnectStep
        state={initDeviceSetup(DEFAULT_DEVICE_PROFILE, null)}
        dispatch={vi.fn()}
      />,
    );
    await act(async () => button('Run read-only checks').click());
    expect(sendConsoleCommand.mock.calls).toEqual([['$I']]);
    expect(readMachineSettings).toHaveBeenCalledTimes(1);
    expect(writeGrblSetting).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
  });
  it('Machine Setup launcher opens the globally owned setup at the capability step', () => {
    render(<DeviceSetupControls />);
    act(() => button('Machine Setup').click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'step', step: 'capability' },
    });
  });

  it('saved profile Delete removes only the selected library entry without changing the project', () => {
    useStore.getState().saveCncMachineProfileFromDraft('Keep', DEFAULT_CNC_MACHINE_CONFIG);
    useStore.getState().saveCncMachineProfileFromDraft('Delete this', DEFAULT_CNC_MACHINE_CONFIG);
    const profiles = useStore.getState().cncLibrary.machineProfiles;
    const target = profiles.find((profile) => profile.name === 'Delete this')!;
    const project = useStore.getState().project;
    render(<DeviceSetupCncProfiles machine={DEFAULT_CNC_MACHINE_CONFIG} onApply={vi.fn()} />);
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Saved setup profile"]')!;
    act(() => {
      select.value = target.id;
      Simulate.change(select);
    });
    act(() => button('Delete').click());
    expect(
      useStore.getState().cncLibrary.machineProfiles.some((profile) => profile.id === target.id),
    ).toBe(false);
    expect(
      useStore.getState().cncLibrary.machineProfiles.some((profile) => profile.name === 'Keep'),
    ).toBe(true);
    expect(useStore.getState().project).toBe(project);
    expect(select.value).toBe('');
  });

  it('tiling enable creates the default draft and disable clears only that optional draft value', () => {
    const onChange = vi.fn();
    render(
      <DeviceSetupCncTilingFields
        tiling={undefined}
        machine={DEFAULT_CNC_MACHINE_CONFIG}
        onChange={onChange}
      />,
    );
    act(() => checkbox('Enable tiling').click());
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CNC_TILING);
    render(
      <DeviceSetupCncTilingFields
        tiling={DEFAULT_CNC_TILING}
        machine={DEFAULT_CNC_MACHINE_CONFIG}
        onChange={onChange}
      />,
    );
    act(() => checkbox('Enable tiling').click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('rotary attachment and reverse toggles return independent draft patches', () => {
    const onChange = vi.fn();
    render(<DeviceSetupRotaryFields value={DEFAULT_ROTARY_SETUP} onChange={onChange} />);
    act(() => checkbox('Enable rotary attachment').click());
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_ROTARY_SETUP,
      enabled: !DEFAULT_ROTARY_SETUP.enabled,
    });
    act(() => checkbox('Reverse rotary direction').click());
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_ROTARY_SETUP, reverseAxis: true });
  });

  it('homing checkbox updates only the setup draft and stays disabled for a file-only controller', () => {
    const dispatch = vi.fn();
    const state = initDeviceSetup(
      { ...DEFAULT_DEVICE_PROFILE, homing: { enabled: false, direction: 'rear-left' } },
      null,
    );
    render(<DeviceSetupConfirmStep state={state} dispatch={dispatch} />);
    act(() => checkbox('Homing enabled').click());
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      kind: 'edit',
      patch: { homing: { enabled: true, direction: 'rear-left' } },
    });
    const unsupported = initDeviceSetup(
      { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
      null,
    );
    render(<DeviceSetupConfirmStep state={unsupported} dispatch={dispatch} />);
    expect(checkbox('Homing enabled').disabled).toBe(true);
  });

  it('Identify disclosures toggle and worker streaming records a draft-only preference', () => {
    const dispatch = vi.fn();
    const state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null);
    render(<DeviceSetupIdentifyStep state={state} dispatch={dispatch} />);
    for (const text of [
      'Advanced connection and streaming',
      'Import or export a machine profile',
    ]) {
      const summary = [...host.querySelectorAll('summary')].find((node) =>
        node.textContent?.includes(text),
      )!;
      const details = summary.parentElement as HTMLDetailsElement;
      act(() => summary.click());
      expect(details.open).toBe(true);
      act(() => summary.click());
      expect(details.open).toBe(false);
    }
    const worker = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => worker.click());
    expect(dispatch).toHaveBeenCalledWith({ kind: 'edit', patch: { workerHostedStreaming: true } });
    expect(useStore.getState().project.device.workerHostedStreaming).not.toBe(true);
  });

  it('each Options disclosure opens and closes without editing the draft', () => {
    const dispatch = vi.fn();
    render(
      <DeviceSetupOptionsStep
        state={initDeviceSetup(DEFAULT_DEVICE_PROFILE, null)}
        dispatch={dispatch}
      />,
    );
    const details = [...host.querySelectorAll('details')];
    expect(details.length).toBeGreaterThanOrEqual(7);
    for (const item of details) {
      const summary = item.querySelector('summary')!;
      const initial = item.open;
      act(() => summary.click());
      expect(item.open).toBe(!initial);
      act(() => summary.click());
      expect(item.open).toBe(initial);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('review Edit buttons navigate to their exact setup owner without committing', () => {
    const dispatch = vi.fn();
    const state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, {
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    });
    render(<DeviceSetupReviewStep state={state} dispatch={dispatch} operationDrafts={[]} />);
    const edit = [...host.querySelectorAll('button')].filter((node) => node.textContent === 'Edit');
    expect(edit).toHaveLength(5);
    for (const item of edit) act(() => item.click());
    expect(dispatch.mock.calls).toEqual(
      [['identify'], ['confirm'], ['cnc-setup'], ['cnc-setup'], ['options']].map(([step]) => [
        { kind: 'go', step },
      ]),
    );
  });

  it('CNC material Apply returns the selected material and explicit manual mode to the operation draft', () => {
    const state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, {
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    });
    const onApplyMaterial = vi.fn();
    const dispatch = vi.fn();
    render(
      <DeviceSetupCncJobStep
        state={state}
        dispatch={dispatch}
        layers={[]}
        operationDrafts={[]}
        customTools={[]}
        onApplyMaterial={onApplyMaterial}
        onChangeOperation={vi.fn()}
        onChangeCustomTools={vi.fn()}
        onRemoveTool={vi.fn()}
      />,
    );
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Project material"]')!;
    const key = [...select.options].find((option) => option.value !== '')!.value;
    act(() => {
      select.value = key;
      Simulate.change(select);
    });
    const apply = [...host.querySelectorAll('button')].find(
      (node) =>
        node.textContent?.startsWith('Apply ') && node.textContent.endsWith(' to operations'),
    )!;
    act(() => apply.click());
    expect(onApplyMaterial).toHaveBeenLastCalledWith(key);
    act(() => {
      select.value = '';
      Simulate.change(select);
    });
    const manual = [...host.querySelectorAll('button')].find(
      (node) =>
        node.textContent?.startsWith('Use ') && node.textContent.toLowerCase().includes('manual'),
    )!;
    act(() => manual.click());
    expect(onApplyMaterial).toHaveBeenLastCalledWith(null);
  });

  it('Reconnect uses the selected controller and command disclosure changes only visibility', async () => {
    const disconnect = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      disconnect,
      connect,
    });
    const state = initDeviceSetup({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' }, null);
    render(<DeviceSetupConnectStep state={state} dispatch={vi.fn()} />);
    await act(async () => button('Reconnect using selected profile').click());
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      platform,
      expect.objectContaining({ controllerKind: 'grblhal' }),
    );
    const summary = host.querySelector('summary')!;
    const details = summary.parentElement as HTMLDetailsElement;
    act(() => summary.click());
    expect(details.open).toBe(true);
    act(() => summary.click());
    expect(details.open).toBe(false);
  });

  it('CNC preset disclosure toggles and external references have explicit secure source destinations', () => {
    const dispatch = vi.fn();
    render(
      <DeviceSetupCncPreset
        state={initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, {
          machine: DEFAULT_CNC_MACHINE_CONFIG,
        })}
        dispatch={dispatch}
      />,
    );
    const summary = host.querySelector('summary')!;
    const details = summary.parentElement as HTMLDetailsElement;
    const initialOpen = details.open;
    act(() => summary.click());
    expect(details.open).toBe(!initialOpen);
    const select = host.querySelector('select')!;
    act(() => {
      select.value = 'onefinity-woodworker';
      Simulate.change(select);
    });
    const links = [...host.querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href).toMatch(/^https:\/\//);
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noreferrer');
    }
    act(() => summary.click());
    expect(details.open).toBe(initialOpen);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
