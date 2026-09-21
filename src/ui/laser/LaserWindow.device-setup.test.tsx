import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { FALCON_COMPATIBLE_PROFILE } from '../../core/devices/falcon-profiles';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../state/device-setup-configured-persistence';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { LaserWindow } from './LaserWindow';
import { MachineSetupDialogHost } from './device-setup';

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
      expect(button(host, 'Machine Setup').className).not.toContain('lf-btn--primary');
      expect(buttons(host, 'Machine Setup')).toHaveLength(1);
      expect(host.textContent).not.toContain('Set up device');
    } finally {
      await unmount();
    }
  });

  it('emphasizes the single Machine Setup action while the connected machine needs setup', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      expect(button(host, 'Machine Setup').className).toContain('lf-btn--primary');
      expect(buttons(host, 'Machine Setup')).toHaveLength(1);
      expect(host.textContent).not.toContain('Set up device');
      expect(button(host, 'Machine Setup').dataset.helpId).toBe(
        'control:laser.machine-setup.launch',
      );
    } finally {
      await unmount();
    }
  });

  it('opens the single guided Machine Setup flow directly', async () => {
    const { host, unmount } = await renderLaserWindow();
    try {
      await act(async () => button(host, 'Machine Setup').click());
      expect(host.textContent).toContain('Step 1 of 3');
      expect(host.querySelectorAll('input[name="machine-capability"]')).toHaveLength(3);
      // The catalog is a plain always-visible section now — never collapsed
      // behind a <details> (ADR-240).
      const profileCatalog = host.querySelector('section[aria-label="Reviewed machine profiles"]');
      expect(profileCatalog?.closest('details')).toBeNull();
      expect(
        profileCatalog?.querySelector('input[aria-label="Search machine profiles"]'),
      ).toBeInstanceOf(HTMLInputElement);
      expect(host.textContent).not.toContain('Run guided setup');
    } finally {
      await unmount();
    }
  });

  it('opens the dedicated auto-focus setup directly from an unconfigured machine', async () => {
    const { host, unmount } = await renderLaserWindow();
    try {
      const setup = button(host, 'Set up auto-focus');
      expect(setup.disabled).toBe(false);

      await act(async () => setup.click());

      expect(host.textContent).toContain('Step 2 of 3');
      expect(host.textContent).toContain('Auto-focus setup');
      expect(host.textContent).toContain('Not configured');
      const field = host.querySelector<HTMLTextAreaElement>('#autofocus-cmd');
      expect(field).toBeInstanceOf(HTMLTextAreaElement);
      expect(field?.closest('details')?.open).toBe(true);
      const accessories = field?.closest('details')?.parentElement?.closest('details');
      expect(accessories?.open).toBe(true);
    } finally {
      await unmount();
    }
  });

  it('offers homing setup in place instead of a dead grey Home button', async () => {
    const { host, unmount } = await renderLaserWindow();
    try {
      // The default profile has homing off, so the rail's home slot must be a
      // live way into Machine Setup rather than an unclickable control.
      expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Home');
      const setupHoming = button(host, 'Set up homing');
      expect(setupHoming.disabled).toBe(false);

      await act(async () => setupHoming.click());

      expect(host.textContent).toContain('Step 2 of 3');
      expect(host.querySelector('input[aria-label="Homing enabled"]')).toBeInstanceOf(
        HTMLInputElement,
      );
    } finally {
      await unmount();
    }
  });

  it('opens the air output controls from Manual Air recovery', async () => {
    const { host, unmount } = await renderLaserWindow();
    try {
      await act(async () => button(host, 'Turn manual air assist on (no air output)').click());
      await act(async () => button(host, 'Open Machine Setup for air assist').click());
      expect(host.textContent).toContain('Step 2 of 3');
      const output = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Air output command"]',
      );
      expect(output).toBeInstanceOf(HTMLSelectElement);
      expect(output?.closest('details')?.open).toBe(true);
      expect(useStore.getState().project.device.airAssistCommand).toBe('none');
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
      await act(async () => button(host, 'Machine Setup').click());
      await act(async () => button(host, 'Check essentials').click());
      await act(async () => button(host, 'Review setup').click());
      await act(async () => button(host, 'Save machine setup').click());
      expect(host.textContent).not.toContain('set up yet');
      // The 4040 fill-policy rail banner was removed at the maintainer's
      // direction (ADR-240 amendment), so a configured machine shows a calm
      // default button again.
      expect(button(host, 'Machine Setup').className).not.toContain('lf-btn--primary');
      // The configured signature is persisted, so a reload re-hydrates it.
      expect(localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toContain(
        'generic-grbl-400x400',
      );
    } finally {
      await unmount();
    }
  });

  it('never shows the removed 4040 fill-policy rail banner', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    for (const profile of [NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, FALCON_COMPATIBLE_PROFILE]) {
      useStore.getState().replaceDeviceProfile(profile);
      const { host, unmount } = await renderLaserWindow();
      try {
        expect(host.textContent).not.toContain(
          'Neotronics-qualified 4040 fill policy is not selected',
        );
      } finally {
        await unmount();
      }
    }
  });

  it('lets Machine Setup restore a drifted 4040 dialect and persists it only on Save', async () => {
    useStore.getState().replaceDeviceProfile({
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      gcodeDialect: { dialectId: 'grbl-dynamic' },
    });
    useLaserStore.setState({ connection: { kind: 'connected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      await act(async () => button(host, 'Machine Setup').click());
      const search = host.querySelector('input[aria-label="Search machine profiles"]');
      if (!(search instanceof HTMLInputElement)) throw new Error('Profile search missing');
      await act(async () => {
        search.value = 'Neotronics 4040';
        Simulate.change(search);
      });
      const restore = button(host, 'Use Neotronics 4040 Max / LT-4LDS-V2 20W');
      expect(restore.disabled).toBe(false);
      await act(async () => restore.click());

      expect(useStore.getState().project.device.gcodeDialect.dialectId).toBe('grbl-dynamic');
      await act(async () => button(host, 'Check essentials').click());
      await act(async () => button(host, 'Review setup').click());
      await act(async () => button(host, 'Save machine setup').click());

      expect(useStore.getState().project.device.gcodeDialect.dialectId).toBe(
        'neotronics-4040-safe',
      );
    } finally {
      await unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = buttons(host, label)[0];
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function buttons(host: HTMLElement, label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')].filter(
    (candidate) =>
      candidate.textContent?.includes(label) ||
      candidate.getAttribute('aria-label')?.includes(label),
  );
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
        <>
          <LaserWindow />
          <MachineSetupDialogHost />
        </>
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
