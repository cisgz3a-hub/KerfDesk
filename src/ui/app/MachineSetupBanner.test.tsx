/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
import { useStore } from '../state';
import { useCanvasViewStore } from '../state/canvas-view-store';
import { useUiStore } from '../state/ui-store';
import { rememberLastMachine } from '../state/last-machine-persistence';
import { resetStore } from '../state/test-helpers';
import { MachineSetupBanner } from './MachineSetupBanner';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  localStorage.clear();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
  useCanvasViewStore.getState().setShowGcode(false);
  useUiStore.getState().closeRegistrationPanel();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

describe('MachineSetupBanner (ADR-500)', () => {
  it('says the machine is the generic starter and opens Machine Setup', async () => {
    await render();
    expect(banner()?.textContent).toContain('Generic 400 × 400 mm machine.');
    expect(banner()?.textContent).toContain('You can design now and set it up later.');

    await act(async () => button('Set up machine').click());

    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
  });

  it('offers the last machine, and Use applies it as one undo step', async () => {
    const shop = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, name: 'Shop Falcon' };
    rememberLastMachine(localStorage, shop);
    await render();
    expect(banner()?.textContent).toContain('Your last machine was Shop Falcon (358 × 268 mm).');
    const undoDepth = useStore.getState().undoStack.length;

    await act(async () => button('Use Shop Falcon').click());

    expect(useStore.getState().project.device).toEqual(shop);
    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
    expect(banner()).toBeNull();
    await act(async () => useStore.getState().undo());
    expect(banner()).not.toBeNull();
  });

  it('hides when a project brings its own machine, and after Not now', async () => {
    await render();
    await act(async () => useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE));
    expect(banner()).toBeNull();
    await act(async () => useStore.getState().undo());
    expect(banner()).not.toBeNull();

    await act(async () => button('Not now').click());

    expect(banner()).toBeNull();
    expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
  });

  it('gives the corner up to the G-code view and the registration jig panel, then returns', async () => {
    await render();
    await act(async () => useCanvasViewStore.getState().setShowGcode(true));
    expect(banner()).toBeNull();
    await act(async () => useCanvasViewStore.getState().setShowGcode(false));
    expect(banner()).not.toBeNull();

    await act(async () => useUiStore.getState().openRegistrationPanel());
    expect(banner()).toBeNull();
    await act(async () => useUiStore.getState().closeRegistrationPanel());
    expect(banner()).not.toBeNull();
  });
});

async function render(): Promise<void> {
  await act(async () => root.render(<MachineSetupBanner />));
}

function banner(): Element | null {
  return host.querySelector('[aria-label="Machine not set up"]');
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) throw new Error(`${label} missing`);
  return found;
}
