import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl';
import { createProject } from '../../../core/scene';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../../state/device-setup-configured-persistence';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { deviceProfileSignature } from './device-setup-nudge';
import { openSetupDisclosure } from './device-setup-test-helpers';
import { mockPlatform } from './device-setup-wizard.test-support';
import { MachineSetupDialogHost } from './MachineSetupDialogHost';
import { openMachineSetup, useMachineSetupDialogStore } from './machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = useLaserStore.getState();
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  resetStore();
  localStorage.clear();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
  useToastStore.setState({ toasts: [] });
  const profile = useStore.getState().project.device;
  localStorage.setItem(
    DEVICE_SETUP_CONFIGURED_STORAGE_KEY,
    JSON.stringify([deviceProfileSignature(profile, 'laser')]),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <MachineSetupDialogHost />
      </PlatformProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState(originalLaser);
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
  useToastStore.setState({ toasts: [] });
  localStorage.clear();
  resetStore();
});

describe('Machine Setup completion keeps its own document and request', () => {
  it.each(['document', 'request', 'reopened request'] as const)(
    'an older pending Save cannot close a replacement %s draft',
    async (replacement) => {
      const pending = await beginPendingSave();
      await act(async () => {
        if (replacement === 'document') {
          useStore.getState().setProject({ ...createProject(), notes: 'Replacement document' });
        } else if (replacement === 'request') {
          openMachineSetup({ kind: 'step', step: 'confirm' });
        } else {
          useMachineSetupDialogStore.getState().close();
        }
      });
      if (replacement === 'reopened request') {
        await act(async () => openMachineSetup({ kind: 'step', step: 'confirm' }));
      }
      const fresh = useMachineSetupDialogStore.getState().state;
      const stage = replacement === 'document' ? 'Step 3 of 3' : 'Step 2 of 3';
      expect(fresh.kind).toBe('open');
      expect(host.textContent).toContain(stage);

      await act(async () => {
        pending.finish();
        await pending.promise;
      });

      expect(useMachineSetupDialogStore.getState().state).toEqual(fresh);
      expect(host.textContent).toContain(stage);
      expect(pending.write).toHaveBeenCalledExactlyOnceWith(30, '1000');
      await act(async () => button('Cancel without saving').click());
      expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
    },
  );

  it('ordinary pending Save closes its own draft after the selected write finishes', async () => {
    const pending = await beginPendingSave();
    expect(host.textContent).toContain('Saving and verifying');
    await act(async () => {
      pending.finish();
      await pending.promise;
    });
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
    expect(host.textContent).not.toContain('Step 3 of 3');
    expect(pending.write).toHaveBeenCalledExactlyOnceWith(30, '1000');
  });
});

async function beginPendingSave() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = vi.fn(async () => promise);
  await act(async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      detectedSettings: null,
      detectedControllerKind: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      grblSettingsRows: settingsMapToRows(new Map([[30, '900']])),
      lastSettingsReadAt: Date.now(),
      writeGrblSetting: write,
    });
    openMachineSetup({ kind: 'step', step: 'review' });
  });
  await openSetupDisclosure(host, 'Controller settings');
  for (const label of ['Confirm controller backup exported', 'Confirm write $30']) {
    const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (field === null) throw new Error(`Missing ${label}`);
    await act(async () => {
      field.checked = true;
      Simulate.change(field);
    });
  }
  await act(async () => button('Queue $30 for Save').click());
  await act(async () => button('Save setup and write 1 setting').click());
  expect(write).toHaveBeenCalledExactlyOnceWith(30, '1000');
  return { finish, promise, write };
}

function button(label: string): HTMLButtonElement {
  const field = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (field === undefined) throw new Error(`Missing ${label}`);
  return field;
}
