import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
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
      await unmountRoot(root);
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

      expect(host.textContent).toContain('Step 1 of 7');
      expect(host.textContent).toContain('Import or export a machine profile');
    } finally {
      await unmountRoot(root);
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
      expect(button(host, 'Frame job').disabled).toBe(true);
      expect(button(host, 'Set up & Frame').disabled).toBe(true);
      expect(button(host, 'Set origin here').disabled).toBe(true);
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
    } finally {
      await unmountRoot(root);
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
      await unmountRoot(root);
      host.remove();
    }
  });

  it('disables jog controls and leaves frame Abort to the Live Motion bar', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      motionOperation: {
        operationId: 1,
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

      expect(host.textContent).toContain('Use ABORT MOTION in the Live Motion bar');
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
    } finally {
      await unmountRoot(root);
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
      expect(button(host, 'Frame job').disabled).toBe(true);

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
      expect(button(host, 'Frame job').disabled).toBe(false);
    } finally {
      await unmountRoot(root);
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
      expect(button(host, 'Frame job').disabled).toBe(true);

      await act(async () => {
        button(host, '$X').click();
        await Promise.resolve();
      });

      expect(unlock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        useLaserStore.setState({ home: originalHome, unlockAlarm: originalUnlock });
      });
      await unmountRoot(root);
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
      await unmountRoot(root);
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
      await unmountRoot(root);
      host.remove();
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

async function unmountRoot(root: Root | null): Promise<void> {
  if (root !== null) await act(async () => root.unmount());
}
