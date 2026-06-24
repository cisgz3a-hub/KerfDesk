import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
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
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    workOriginActive: false,
    wcoCache: null,
    safetyNotice: null,
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  useToastStore.setState({ toasts: [] });
});

describe('LaserWindow autofocus busy controls', () => {
  it('shows a toast when controller settings auto-detection completes', async () => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      await act(async () => {
        useLaserStore.setState({
          detectedSettings: { maxPowerS: 255 },
          controllerSettings: { maxPowerS: 255 },
          grblSettingsRows: [],
          lastSettingsReadAt: 123,
        });
      });

      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'info',
        message: expect.stringMatching(/machine settings detected/i),
      });
      expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Machine Setup');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
      useToastStore.setState({ toasts: [] });
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('opens Machine Setup from a compact rail entry', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(host.textContent).not.toContain('Use Neotronics 4040 Max');
      expect(button(host, 'Machine Setup')).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        button(host, 'Machine Setup').click();
      });

      expect(host.textContent).toContain('Profile Catalog');
      expect(host.textContent).toContain('Import / Export');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('disables motion, origin, and disconnect controls while autofocus is active', async () => {
    useStore.setState({
      project: createProject({
        ...DEFAULT_DEVICE_PROFILE,
        homing: { enabled: true, direction: 'front-left' },
        autofocusCommand: '$HZ1',
      }),
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      autofocusBusy: true,
      streamer: null,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(button(host, 'Disconnect').disabled).toBe(true);
      expect(button(host, 'Home').disabled).toBe(true);
      expect(button(host, 'Auto-focus').disabled).toBe(true);
      expect(button(host, 'Frame').disabled).toBe(true);
      expect(button(host, 'Start job').disabled).toBe(true);
      expect(button(host, 'Set origin here').disabled).toBe(true);
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('surfaces a safety notice banner when the store raises one', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      safetyNotice: {
        kind: 'disconnect-during-job',
        message: 'USB lost mid-job. Use physical E-stop.',
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(host.textContent).toContain('USB lost mid-job. Use physical E-stop.');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('disables jog controls and shows Cancel frame while Frame is active', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: false,
      },
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(button(host, 'Cancel frame').disabled).toBe(false);
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

describe('LaserWindow jog gating during a job (H6)', () => {
  it('keeps Jog and Frame disabled until GRBL reports Idle after connect', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: null,
      streamer: null,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      const arrows = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Jog "]')];
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) expect(arrow.disabled).toBe(true);
      expect(button(host, 'Frame').disabled).toBe(true);

      await act(async () => {
        useLaserStore.setState({
          statusReport: {
            state: 'Idle',
            subState: null,
            mPos: { x: 0, y: 0, z: 0 },
            wPos: null,
            wco: null,
            feed: 0,
            spindle: 0,
          },
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
      });

      for (const arrow of arrows) expect(arrow.disabled).toBe(false);
      expect(button(host, 'Frame').disabled).toBe(false);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('shows recovery controls when GRBL reports status-only Alarm after connect', async () => {
    const originalHome = useLaserStore.getState().home;
    const originalUnlock = useLaserStore.getState().unlockAlarm;
    const unlock = vi.fn(async () => undefined);
    useStore.setState({
      project: createProject({
        ...DEFAULT_DEVICE_PROFILE,
        homing: { enabled: true, direction: 'front-left' },
      }),
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Alarm',
        subState: null,
        mPos: { x: 0, y: 0, z: 12.089 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      alarmCode: null,
      streamer: null,
      home: vi.fn(async () => undefined),
      unlockAlarm: unlock,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(host.textContent).toContain('Controller reports Alarm');
      expect(host.textContent).toContain('Home ($H)');
      const arrows = [...host.querySelectorAll('button')].filter((b) =>
        ['â†‘', 'â†“', 'â†', 'â†’'].includes(b.textContent ?? ''),
      );
      for (const arrow of arrows) expect(arrow.disabled).toBe(true);
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
      expect(button(host, 'Frame').disabled).toBe(true);

      await act(async () => {
        button(host, '$X').click();
        await Promise.resolve();
      });

      expect(unlock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        useLaserStore.setState({ home: originalHome, unlockAlarm: originalUnlock });
      });
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('disables the JogPad while a job is streaming', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      // Same path the store takes on startJob: a genuinely 'streaming' state,
      // so the gate is tested against the real streamer status.
      streamer: step(createStreamer('G1 X1 S100')).state,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      const arrows = [...host.querySelectorAll('button')].filter((b) =>
        ['↑', '↓', '←', '→'].includes(b.textContent ?? ''),
      );
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) expect(arrow.disabled).toBe(true);
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('keeps the JogPad enabled when connected with no active job', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      streamer: null,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      const arrows = [...host.querySelectorAll('button')].filter((b) =>
        ['↑', '↓', '←', '→'].includes(b.textContent ?? ''),
      );
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) expect(arrow.disabled).toBe(false);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

describe('LaserWindow device-setup nudge', () => {
  it('nudges to set up an unconfigured machine when connected', async () => {
    localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
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
    localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
    useLaserStore.setState({ connection: { kind: 'disconnected' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLaserWindow();
    try {
      expect(host.textContent).not.toContain('set up yet');
    } finally {
      await unmount();
    }
  });

  it('clears the nudge after the machine is set up through the wizard', async () => {
    localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
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
      // The configured signature is persisted, so a reload re-hydrates it.
      expect(localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toContain(
        'creality-falcon-a1-pro-compatible',
      );
    } finally {
      localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
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
