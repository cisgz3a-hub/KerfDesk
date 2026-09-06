import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { LaserWindow } from './LaserWindow';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const initialLaserState = useLaserStore.getState();
const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  useLaserStore.setState(initialLaserState);
  useStore.getState().newProject();
});

async function renderAlarm(controllerKind: ControllerKind, code: number | null) {
  useStore.setState({
    project: createProject({
      ...DEFAULT_DEVICE_PROFILE,
      homing: { enabled: true, direction: 'front-left' },
    }),
  });
  useLaserStore.setState({
    connection: { kind: 'connected' },
    activeControllerKind: controllerKind,
    detectedControllerKind: controllerKind === 'fluidnc' ? 'grbl-v1.1' : 'fluidnc',
    alarmCode: code,
    statusReport: {
      state: 'Alarm',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
  });
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
  const banner = [...host.querySelectorAll('[role="alert"]')].find((candidate) =>
    candidate
      .querySelector('strong')
      ?.textContent?.startsWith(code === null ? 'Controller reports Alarm' : `Alarm ${code}:`),
  );
  return {
    banner,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

describe('configured-family alarm banner', () => {
  it.each([
    [10, 'Spindle Control'],
    [12, 'Ambiguous Switch'],
    [99, 'unknown'],
  ] as const)('renders FluidNC alarm %s without stock recovery metadata', async (code, title) => {
    const { banner, unmount } = await renderAlarm('fluidnc', code);
    try {
      expect(banner?.querySelector('strong')?.textContent).toBe(`Alarm ${code}: ${title}`);
      expect([...banner!.querySelectorAll('p')].every((p) => p.textContent === '')).toBe(true);
      expect(banner?.textContent).not.toContain(STATUS_ALARM_START_MESSAGE);
      expect([...banner!.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
        'Home ($H)',
        '$X — Unlock',
      ]);
    } finally {
      await unmount();
    }
  });

  it.each(['grbl-v1.1', 'grblhal'] as const)(
    'preserves unknown %s fallback action',
    async (kind) => {
      const { banner, unmount } = await renderAlarm(kind, 99);
      try {
        expect(banner?.textContent).toContain('Alarm 99: unknown');
        expect(banner?.textContent).toContain(STATUS_ALARM_START_MESSAGE);
      } finally {
        await unmount();
      }
    },
  );

  it('preserves known grblHAL recovery metadata', async () => {
    const { banner, unmount } = await renderAlarm('grblhal', 10);
    try {
      expect(banner?.textContent).toContain('Alarm 10: E-stop asserted (grblHAL)');
      expect(banner?.textContent).toContain('Release the E-stop, soft-reset, then $X to unlock.');
    } finally {
      await unmount();
    }
  });

  it.each(['fluidnc', 'grbl-v1.1', 'grblhal'] as const)(
    'keeps status-only %s alarm recovery guidance',
    async (kind) => {
      const { banner, unmount } = await renderAlarm(kind, null);
      try {
        expect(banner?.textContent).toContain('Controller reports Alarm');
        expect(banner?.textContent).toContain(STATUS_ALARM_START_MESSAGE);
      } finally {
        await unmount();
      }
    },
  );
});
