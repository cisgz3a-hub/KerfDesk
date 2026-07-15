import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

beforeEach(resetTestState);
afterEach(resetTestState);

describe('DeviceSetupWizard detected values', () => {
  it('confirms applied values, keeps them draft-only, and clears confirmation on a new read', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Next').click());
      expect(view.host.querySelector('[role="status"]')).toBeNull();

      await act(async () => button(view.host, 'Use detected values').click());
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
        'Detected values applied to this setup draft',
      );
      expect(useStore.getState().project.device.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);

      await act(async () => {
        useLaserStore.setState({
          detectedSettings: { bedWidth: 364, bedHeight: 274 },
          lastSettingsReadAt: 2,
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
      });
      expect(view.host.querySelector('[role="status"]')).toBeNull();

      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('363');
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
      <PlatformProvider adapter={platform}>
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

function resetTestState(): void {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    detectedControllerKind: null,
    activeControllerKind: 'grbl-v1.1',
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

function input(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Input missing: ${ariaLabel}`);
  return field;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
