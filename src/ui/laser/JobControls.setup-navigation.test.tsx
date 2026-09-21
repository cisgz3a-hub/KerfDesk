import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  closeMachineSetup,
  useMachineSetupDialogStore,
} from './device-setup/machine-setup-dialog-store';
import { MachineSetupDialogHost } from './device-setup/MachineSetupDialogHost';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const adapter: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

beforeEach(() => {
  useStore.setState({ project: createProject() });
  useLaserStore.setState(initialLaserState());
  closeMachineSetup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  closeMachineSetup();
  useLaserStore.setState(initialLaserState());
});

function button(label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <PlatformProvider adapter={adapter}>
        <JobControls disabled dockedJobActions onStartJob={() => undefined} />
        <MachineSetupDialogHost />
      </PlatformProvider>,
    );
  });
  const summary = [...host.querySelectorAll('summary')].find(
    (node) => node.textContent === 'Homing & focus',
  );
  await act(async () => summary?.click());
}

describe('machine setup navigation without parent callbacks', () => {
  it('opens homing configuration while disconnected instead of silently doing nothing', async () => {
    const project = useStore.getState().project;
    await render();
    expect(button('Set up homing').disabled).toBe(false);
    await act(async () => button('Set up homing').click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'step', step: 'confirm' },
    });
    const editor = host.querySelector('fieldset[aria-label="Essentials"]');
    expect(editor).not.toBeNull();
    expect(editor?.querySelector('input[aria-label="Homing enabled"]')).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Go to step 2: Essentials"]')?.getAttribute('aria-current'),
    ).toBe('step');
    expect(host.querySelectorAll('[aria-label="Machine Setup steps"] button')).toHaveLength(3);
    expect(useStore.getState().project).toBe(project);
  });

  it('opens the autofocus page with its field highlighted', async () => {
    const project = useStore.getState().project;
    const autofocus = vi.fn(async () => ({ kind: 'ok' as const }));
    const originalAutofocus = useLaserStore.getState().autofocus;
    useLaserStore.setState({ autofocus });
    try {
      await render();
      await act(async () => button('Set up auto-focus').click());
      expect(useMachineSetupDialogStore.getState().state).toMatchObject({
        kind: 'open',
        target: { kind: 'step', step: 'options', highlight: 'autofocus' },
      });
      const editor = host.querySelector('fieldset[aria-label="Essentials"]');
      const field = editor?.querySelector('textarea#autofocus-cmd');
      expect(field).not.toBeNull();
      expect(field?.closest('details')?.open).toBe(true);
      expect(field?.closest('details')?.parentElement?.closest('details')?.open).toBe(true);
      expect(autofocus).not.toHaveBeenCalled();
      expect(useStore.getState().project).toBe(project);
    } finally {
      act(() => useLaserStore.setState({ autofocus: originalAutofocus }));
    }
  });

  it('still refuses setup edits during an active Frame', async () => {
    useLaserStore.setState({
      motionOperation: {
        operationId: 1,
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: false,
        pendingLines: [],
      },
    });
    await render();
    expect(button('Set up homing').disabled).toBe(true);
    expect(button('Set up auto-focus').disabled).toBe(true);
    await act(async () => button('Set up homing').click());
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
  });
});
