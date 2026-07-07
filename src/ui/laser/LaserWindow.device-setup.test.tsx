import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../state/device-setup-configured-persistence';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: {
    isSupported: () => true,
    requestPort: async () => null,
  },
};

afterEach(() => {
  localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  useToastStore.setState({ toasts: [] });
});

describe('LaserWindow device-setup nudge', () => {
  it('nudges to set up an unconfigured machine when connected', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      expect(host.textContent).toContain('set up yet');
    } finally {
      await unmount();
    }
  });

  it('does not nudge when disconnected', async () => {
    useLaserStore.setState({ connection: { kind: 'disconnected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      expect(host.textContent).not.toContain('set up yet');
      expect(button(host, 'Set up device').className).not.toContain('lf-btn--primary');
    } finally {
      await unmount();
    }
  });

  it('emphasizes Set up device only while the connected machine needs setup', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      expect(button(host, 'Set up device').className).toContain('lf-btn--primary');
      expect(button(host, 'Machine Setup').className).not.toContain('lf-btn--primary');
      expect(button(host, 'Machine Setup').dataset.helpId).toBe(
        'control:laser.machine-setup.launch',
      );
    } finally {
      await unmount();
    }
  });

  it('opens the guided wizard from the Machine Setup Overview cross-link', async () => {
    const { host, unmount } = await renderLaserWindow();
    try {
      await act(async () => button(host, 'Machine Setup').click());
      expect(host.textContent).toContain('Profile Catalog');
      await act(async () => button(host, 'Run guided setup').click());
      expect(host.textContent).not.toContain('Profile Catalog');
      expect(host.textContent).toContain('Step 1 of');
      expect(host.textContent).toContain('Connect & read');
    } finally {
      await unmount();
    }
  });

  it('clears the nudge after the machine is set up through the wizard', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      expect(host.textContent).toContain('set up yet');
      await act(async () => button(host, 'Set up device').click());
      await act(async () => button(host, 'Next').click()); // connect -> identify
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());
      for (let guard = 0; guard < 8; guard += 1) {
        const atReview = [...host.querySelectorAll('button')].some((candidate) =>
          candidate.textContent?.includes('Finish setup'),
        );
        if (atReview) break;
        await act(async () => button(host, 'Next').click());
      }
      await act(async () => button(host, 'Finish setup').click());
      expect(host.textContent).not.toContain('set up yet');
      // Setup recorded — the wizard entry drops its primary emphasis too.
      expect(button(host, 'Set up device').className).not.toContain('lf-btn--primary');
      // The configured signature is persisted, so a reload re-hydrates it.
      expect(localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toContain(
        'creality-falcon-a1-pro-grblhal',
      );
    } finally {
      await unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

async function renderLaserWindow(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <LaserWindow />
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
