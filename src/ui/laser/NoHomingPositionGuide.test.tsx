import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { NoHomingPositionGuide } from './NoHomingPositionGuide';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = {
  releaseMotors: useLaserStore.getState().releaseMotors,
  wakeController: useLaserStore.getState().wakeController,
  unlockAlarm: useLaserStore.getState().unlockAlarm,
  setOriginHere: useLaserStore.getState().setOriginHere,
  capabilities: useLaserStore.getState().capabilities,
};

type LaserStatus = NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>;

function status(state: LaserStatus['state']): LaserStatus {
  return { state } as LaserStatus;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

async function renderGuide(host: HTMLElement): Promise<Root> {
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<NoHomingPositionGuide disabled={false} streaming={false} />);
  });
  if (root === null) throw new Error('Guide did not mount');
  return root;
}

afterEach(() => {
  useStore.setState({
    project: createProject(),
    jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
  });
  useLaserStore.setState({
    ...originalLaser,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    controllerOperation: null,
  });
  vi.restoreAllMocks();
});

describe('NoHomingPositionGuide', () => {
  it('selects Current Position without setting an origin', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      setOriginHere,
      capabilities: { ...originalLaser.capabilities, sleep: true },
    });
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      await act(async () => button(host, 'Use current head position').click());
      expect(useStore.getState().jobPlacement).toEqual({
        startFrom: 'current-position',
        anchor: 'center',
      });
      expect(setOriginHere).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('guides Release, Wake, explicit Unlock, Set origin, then Verified Origin', async () => {
    let failWake: ((cause: Error) => void) | null = null;
    const wakeController = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          failWake = reject;
        }),
    );
    const releaseMotors = vi.fn(async () => undefined);
    const unlockAlarm = vi.fn(async () => undefined);
    const setOriginHere = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      capabilities: { ...originalLaser.capabilities, sleep: true, unlock: true },
      releaseMotors,
      wakeController,
      unlockAlarm,
      setOriginHere,
    });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      await act(async () => {
        button(host, 'Move head by hand').click();
        await Promise.resolve();
      });
      expect(releaseMotors).toHaveBeenCalledTimes(1);

      await act(async () => useLaserStore.setState({ statusReport: status('Sleep') }));
      await act(async () => button(host, 'Use this position').click());
      expect(wakeController).toHaveBeenCalledTimes(1);

      await act(async () => {
        useLaserStore.setState({ statusReport: status('Alarm') });
        if (failWake === null) throw new Error('Wake rejector was not captured');
        failWake(new Error('Controller entered Alarm.'));
        await Promise.resolve();
      });
      await act(async () => button(host, 'Unlock and continue').click());
      expect(unlockAlarm).toHaveBeenCalledTimes(1);

      await act(async () => {
        useLaserStore.setState({ statusReport: status('Idle') });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setOriginHere).toHaveBeenCalledTimes(1);
      expect(useStore.getState().jobPlacement.startFrom).toBe('verified-origin');
      expect(host.textContent).toContain('Hand position ready');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('does not render for a homing-enabled profile', async () => {
    const project = createProject();
    useStore.setState({
      project: {
        ...project,
        device: {
          ...project.device,
          homing: { ...project.device.homing, enabled: true },
        },
      },
    });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      expect(host.textContent).toBe('');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
