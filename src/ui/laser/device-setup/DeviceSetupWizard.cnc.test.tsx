import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const adapter: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedControllerKind: null,
    detectedSettings: null,
    controllerSettings: null,
    lastSettingsReadAt: null,
  });
});

describe('DeviceSetupWizard router commit', () => {
  it('applies accepted settings without replacing the user-selected firmware profile', async () => {
    useStore.getState().setMachineKind('cnc');
    const originalMaxPowerS = useStore.getState().project.device.maxPowerS;
    const originalControllerKind = useStore.getState().project.device.controllerKind;
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      detectedSettings: { maxPowerS: 24000, bedWidth: 750, bedHeight: 610 },
      controllerSettings: { maxPowerS: 24000, bedWidth: 750, bedHeight: 610 },
      lastSettingsReadAt: 1718600000000,
    });
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Next').click()); // choose your machine
      await act(async () => button(view.host, 'Next').click()); // connect & detect
      await act(async () => button(view.host, 'Use detected values').click());
      await act(async () => button(view.host, 'Next').click()); // confirm settings
      expect(input(view.host, 'Bed width (mm)').value).toBe('750');
      expect(input(view.host, 'Spindle maximum').value).toBe('24000');
      expect(view.host.textContent).not.toContain('Laser output and accessories');

      await advanceUntil(view.host, 'Step 6 of 6 — Review & save');
      await act(async () => button(view.host, 'Save machine setup').click());

      const state = useStore.getState();
      const machine = state.project.machine;
      if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');
      expect(state.project.device).toMatchObject({
        bedWidth: 750,
        bedHeight: 610,
        maxPowerS: originalMaxPowerS,
      });
      expect(state.project.device.controllerKind).toBe(originalControllerKind);
      expect(machine.params.spindleMaxRpm).toBe(24000);
      expect(state.project.workspace).toMatchObject({ width: 750, height: 610 });
    } finally {
      await view.unmount();
    }
  });

  it('clears controller-read values after a real disconnect', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ params: { spindleMaxRpm: 12000 } });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      detectedSettings: { maxPowerS: 24000, bedWidth: 750, bedHeight: 610 },
      lastSettingsReadAt: 1718600000000,
    });
    const view = await renderWizard();
    try {
      await act(async () => {
        useLaserStore.setState({
          connection: { kind: 'disconnected' },
          detectedControllerKind: null,
          detectedSettings: null,
          lastSettingsReadAt: null,
        });
      });
      await act(async () => button(view.host, 'Next').click()); // choose your machine
      await act(async () => button(view.host, 'Next').click()); // connect & detect
      expect(view.host.textContent).toContain('No mapped values have been read');
      expect(view.host.textContent).not.toContain('Use detected values');
      await act(async () => button(view.host, 'Next').click()); // confirm settings
      expect(view.host.textContent).toContain('No controller values were imported');
      expect(input(view.host, 'Spindle maximum').value).toBe('12000');
    } finally {
      await view.unmount();
    }
  });
});

async function renderWizard(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <DeviceSetupWizard onClose={() => undefined} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function advanceUntil(host: HTMLElement, text: string): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    if (host.textContent?.includes(text) === true) return;
    await act(async () => button(host, 'Next').click());
  }
  throw new Error(`did not reach: ${text}`);
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button missing: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input missing: ${label}`);
  return match;
}
