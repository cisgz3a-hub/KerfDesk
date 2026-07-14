import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { OverviewPanel, ProfileCatalogPanel } from './MachineSetupProfiles';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: null,
    detectedSettings: null,
    controllerSettings: null,
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('Machine Setup profile choice', () => {
  it('shows detected firmware as information without a mismatch guard', async () => {
    useStore.getState().updateDeviceProfile({ controllerKind: 'grbl-v1.1' });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'marlin',
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    const view = await render(<OverviewPanel />);
    try {
      expect(view.host.textContent).toContain('Controllergrbl-v1.1');
      expect(view.host.textContent).toContain('Connectiongrbl-v1.1');
      expect(view.host.textContent).toContain('Detectedmarlin');
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
      expect(view.host.textContent).not.toContain('Apply detected firmware');
      expect(useStore.getState().project.device.controllerKind).toBe('grbl-v1.1');
    } finally {
      await view.unmount();
    }
  });

  it('applies the selected catalog profile exactly despite different detected firmware', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'marlin',
      detectedControllerKind: 'marlin',
      lastSettingsReadAt: 1718600000000,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    const view = await render(<ProfileCatalogPanel />);
    try {
      const falconCard = [...view.host.querySelectorAll('article')].find((card) =>
        card.textContent?.includes('Creality Falcon A1 Pro'),
      );
      const apply = button(falconCard as HTMLElement, 'Use Creality Falcon A1 Pro (grblHAL)');
      expect(apply.disabled).toBe(false);
      expect(falconCard?.textContent).not.toContain('Will set controllerKind');
      await act(async () => apply.click());
      expect(useStore.getState().project.device).toMatchObject({
        controllerKind: 'grblhal',
        streamingMode: 'char-counted',
        gcodeDialect: { dialectId: 'grbl-dynamic' },
      });
    } finally {
      await view.unmount();
    }
  });

  it('does not rewrite a selected profile from the active driver when the banner was missed', async () => {
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: null,
      controllerSettings: { maxFeed: 6000 },
      lastSettingsReadAt: 1718600000000,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    const view = await render(<ProfileCatalogPanel />);
    try {
      const marlinCard = [...view.host.querySelectorAll('article')].find((card) =>
        card.textContent?.includes('Generic Marlin'),
      );
      const apply = button(marlinCard as HTMLElement, 'Use Generic Marlin laser 300×200');
      expect(apply.disabled).toBe(false);
      expect(marlinCard?.textContent).not.toContain('Will set controllerKind');
      await act(async () => apply.click());
      expect(useStore.getState().project.device).toMatchObject({
        controllerKind: 'marlin',
        streamingMode: 'ping-pong',
        gcodeDialect: { dialectId: 'marlin-inline' },
      });
    } finally {
      await view.unmount();
    }
  });
});

async function render(element: React.ReactNode): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(element);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return match;
}
