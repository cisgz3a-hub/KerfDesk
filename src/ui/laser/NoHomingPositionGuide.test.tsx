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
    jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
  });
  useLaserStore.setState({
    ...originalLaser,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    controllerOperation: null,
    workOriginActive: false,
    wcoCache: null,
  });
  vi.restoreAllMocks();
});

describe('NoHomingPositionGuide', () => {
  // ADR-225: the guide is a plain hand-positioning card. Jog placement lives
  // in the placement block (Start from = Current Position), not here.
  it('offers hand positioning in plain language with no jog-method card', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      capabilities: { ...originalLaser.capabilities, sleep: true },
    });
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      expect(host.textContent).toContain('release the motors');
      expect(host.textContent).not.toContain('Choose jog positioning');
      expect(host.textContent).not.toContain('Jog with controls');
      expect(button(host, 'Release motors to move by hand')).toHaveProperty('disabled', false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps hand positioning available while Current Position is selected', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      capabilities: { ...originalLaser.capabilities, sleep: true },
    });
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      expect(button(host, 'Release motors to move by hand')).toHaveProperty('disabled', false);
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
        button(host, 'Release motors to move by hand').click();
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

  // A custom work origin means positioning is already settled — the card must
  // leave the rail once the operator clicks Set origin here (maintainer,
  // 2026-07-17). Reset origin brings it back.
  it('hides once a custom work origin is active', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      capabilities: { ...originalLaser.capabilities, sleep: true },
      workOriginActive: true,
    });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      expect(host.textContent).toBe('');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('dismisses a stale released-motors step when origin is set outside the guide', async () => {
    const releaseMotors = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      capabilities: { ...originalLaser.capabilities, sleep: true },
      releaseMotors,
    });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      await act(async () => {
        button(host, 'Release motors to move by hand').click();
        await Promise.resolve();
      });
      expect(host.textContent).toContain('Waiting for Sleep');
      // Operator wakes the controller elsewhere, jogs, and clicks Set origin
      // here — the guide's sticky step must not keep claiming motors are
      // released.
      await act(async () =>
        useLaserStore.setState({ statusReport: status('Idle'), workOriginActive: true }),
      );
      expect(host.textContent).toBe('');
      // Reset origin re-opens the guide at its entry step, not the stale one.
      await act(async () => useLaserStore.setState({ workOriginActive: false }));
      expect(host.textContent).toContain('release the motors');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('still guides hand positioning while the controller sleeps with no origin', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Sleep'),
      capabilities: { ...originalLaser.capabilities, sleep: true },
      workOriginActive: false,
      wcoCache: null,
    });
    const host = document.createElement('div');
    const root = await renderGuide(host);
    try {
      expect(button(host, 'Use this position')).toHaveProperty('disabled', false);
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
