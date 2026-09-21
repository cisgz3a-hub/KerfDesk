import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  closeMachineSetup,
  useMachineSetupDialogStore,
} from './device-setup/machine-setup-dialog-store';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

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
    root.render(<JobControls disabled dockedJobActions onStartJob={() => undefined} />);
  });
  const summary = [...host.querySelectorAll('summary')].find(
    (node) => node.textContent === 'Homing & focus',
  );
  await act(async () => summary?.click());
}

describe('machine setup navigation without parent callbacks', () => {
  it('opens homing configuration while disconnected instead of silently doing nothing', async () => {
    await render();
    expect(button('Set up homing').disabled).toBe(false);
    await act(async () => button('Set up homing').click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'step', step: 'confirm' },
    });
  });

  it('opens the autofocus page with its field highlighted', async () => {
    await render();
    await act(async () => button('Set up auto-focus').click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'step', step: 'options', highlight: 'autofocus' },
    });
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
