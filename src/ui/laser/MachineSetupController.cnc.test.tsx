import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { ControllerSettingsPanel } from './MachineSetupController';

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
  useLaserStore.setState({ controllerSettings: null, detectedSettings: null });
});

describe('router controller settings', () => {
  it('shows spindle detection instead of the laser power apply surface', async () => {
    useStore.getState().setMachineKind('cnc');
    useLaserStore.setState({
      controllerSettings: { maxPowerS: 24000, bedWidth: 750, bedHeight: 610 },
      detectedSettings: { maxPowerS: 24000, bedWidth: 750, bedHeight: 610 },
    });
    const view = await renderPanel();
    try {
      expect(view.host.textContent).toContain('spindle max 24000 RPM');
      expect(view.host.textContent).not.toContain('Your laser');
      expect(view.host.textContent).not.toContain('Max power (S)');
    } finally {
      await view.unmount();
    }
  });
});

async function renderPanel(): Promise<{
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
        <ControllerSettingsPanel />
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
