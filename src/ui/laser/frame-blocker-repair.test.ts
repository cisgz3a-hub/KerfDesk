import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { offerFrameBlockerFixes } from './frame-blocker-repair';
import {
  HOME_OFFER_PROMPT,
  UNLOCK_OFFER_PROMPT,
  UNLOCKED_NEXT_STEP_MESSAGE,
} from './start-blocked-alarm-offers';
import { SET_ORIGIN_OFFER_PROMPT } from './start-blocked-setup-offers';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

function status(state: StatusReport['state'], wco: StatusReport['wco'] = null): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x: 50, y: 60, z: 0 },
    wPos: null,
    wco,
    feed: 0,
    spindle: 0,
  };
}

function installProject(homingEnabled: boolean): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        homing: { ...project.device.homing, enabled: homingEnabled },
      },
    },
  });
}

function recoveredIdle(): void {
  useLaserStore.setState({ alarmCode: null, statusReport: status('Idle', { x: 0, y: 0, z: 0 }) });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  installProject(false);
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: status('Idle', { x: 0, y: 0, z: 0 }),
    wcoCache: { x: 0, y: 0, z: 0 },
    // A controller answers each status query with a fresh report.
    requestControllerStatus: vi.fn(async () => {
      useLaserStore.setState((state) => ({ statusSequence: state.statusSequence + 1 }));
    }),
    home: vi.fn(async () => recoveredIdle()),
    unlockAlarm: vi.fn(async () => recoveredIdle()),
    setOriginHere: vi.fn(async () => {
      useLaserStore.setState({ workOriginActive: true, wcoCache: { x: 50, y: 60, z: 0 } });
    }),
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('offerFrameBlockerFixes — alarm', () => {
  beforeEach(() => {
    useLaserStore.setState({ alarmCode: 1, statusReport: status('Alarm') });
  });

  it('offers Home on a machine with homing switches, then lets the Frame continue', async () => {
    installProject(true);
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(200);
    await expect(repaired).resolves.toBe(true);
    expect(jobAwareConfirm).toHaveBeenCalledWith(HOME_OFFER_PROMPT);
    expect(useLaserStore.getState().home).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().unlockAlarm).not.toHaveBeenCalled();
  });

  it('offers Unlock on a machine without homing switches, then hands over to Set origin', async () => {
    await expect(offerFrameBlockerFixes()).resolves.toBe(false);
    expect(jobAwareConfirm).toHaveBeenCalledWith(UNLOCK_OFFER_PROMPT);
    expect(useLaserStore.getState().unlockAlarm).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(UNLOCKED_NEXT_STEP_MESSAGE);
  });

  it('leaves a declined alarm to the ordinary Frame refusal', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerFrameBlockerFixes()).resolves.toBe(true);
    expect(useLaserStore.getState().unlockAlarm).not.toHaveBeenCalled();
  });

  it('stops the Frame quietly while an accepted Home has not settled', async () => {
    installProject(true);
    useLaserStore.setState({ home: vi.fn(async () => undefined) });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(4_100);
    await expect(repaired).resolves.toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Homed. Try again once the controller reports Idle.',
    );
  });

  it('waits for a report taken after Home before the Frame reads the position', async () => {
    installProject(true);
    // Home settles on a report whose position was still suppressed.
    useLaserStore.setState({
      home: vi.fn(async () => {
        useLaserStore.setState({
          alarmCode: null,
          statusReport: { ...status('Idle'), mPos: null },
        });
      }),
      requestControllerStatus: vi.fn(async () => {
        useLaserStore.setState((state) => ({
          statusSequence: state.statusSequence + 1,
          statusReport: status('Idle', { x: 0, y: 0, z: 0 }),
        }));
      }),
    });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(200);
    await expect(repaired).resolves.toBe(true);
    expect(useLaserStore.getState().requestControllerStatus).toHaveBeenCalled();
    expect(useLaserStore.getState().statusReport?.mPos).not.toBeNull();
  });

  it('does not chain a Set origin offer after Home', async () => {
    installProject(true);
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(repaired).resolves.toBe(true);
    expect(jobAwareConfirm).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().setOriginHere).not.toHaveBeenCalled();
  });
});

describe('offerFrameBlockerFixes — placement and status', () => {
  it('offers Set origin here when User Origin has no origin yet', async () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(repaired).resolves.toBe(true);
    expect(jobAwareConfirm).toHaveBeenCalledWith(SET_ORIGIN_OFFER_PROMPT);
    expect(useLaserStore.getState().setOriginHere).toHaveBeenCalledTimes(1);
  });

  it('waits for a report taken after Set origin, not the one carrying the old offset', async () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    useLaserStore.setState({
      requestControllerStatus: vi.fn(async () => {
        useLaserStore.setState((state) => ({
          statusSequence: state.statusSequence + 1,
          statusReport: status('Idle', { x: 50, y: 60, z: 0 }),
        }));
      }),
    });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(200);
    await expect(repaired).resolves.toBe(true);
    expect(useLaserStore.getState().statusReport?.wco).toEqual({ x: 50, y: 60, z: 0 });
  });

  it('asks for the offset before judging an origin-relative placement', async () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    let queries = 0;
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      wcoCache: null,
      statusReport: status('Idle'),
      requestControllerStatus: vi.fn(async () => {
        queries += 1;
        if (queries === 3) useLaserStore.setState({ wcoCache: { x: 50, y: 60, z: 0 } });
      }),
    });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(500);
    await expect(repaired).resolves.toBe(true);
    expect(queries).toBe(3);
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('asks for a first status report before judging the machine', async () => {
    useLaserStore.setState({
      statusReport: null,
      requestControllerStatus: vi.fn(async () => {
        useLaserStore.setState({ statusReport: status('Idle', { x: 0, y: 0, z: 0 }) });
      }),
    });
    const repaired = offerFrameBlockerFixes();
    await vi.advanceTimersByTimeAsync(100);
    await expect(repaired).resolves.toBe(true);
    expect(useLaserStore.getState().requestControllerStatus).toHaveBeenCalled();
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('leaves machine blocks without an in-place fix to the ordinary refusal', async () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    useLaserStore.setState({ statusReport: status('Hold', { x: 0, y: 0, z: 0 }) });
    await expect(offerFrameBlockerFixes()).resolves.toBe(true);
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});
