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

describe('Machine Setup controller compatibility', () => {
  it('shows configured, active, and detected identity with a mismatch alert', async () => {
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
      expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
        'Controller mismatch',
      );
    } finally {
      await view.unmount();
    }
  });

  it('disables and explains catalog profiles for another detected firmware family', async () => {
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
      expect(button(falconCard as HTMLElement, 'Firmware mismatch').disabled).toBe(true);
      expect(falconCard?.textContent).toContain('Will set controllerKind to marlin');
      expect(falconCard?.textContent).toContain('Will set streamingMode to ping-pong');
      expect(falconCard?.textContent).toContain('Will set gcodeDialect to marlin-inline');
    } finally {
      await view.unmount();
    }
  });

  it('uses the active driver after a settings read when the welcome banner was missed', async () => {
    useStore.getState().updateDeviceProfile({ controllerKind: 'grbl-v1.1' });
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
      expect(button(marlinCard as HTMLElement, 'Firmware mismatch').disabled).toBe(true);
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
