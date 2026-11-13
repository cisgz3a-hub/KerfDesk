// A Moshi job seen by the app's always-mounted guards (ADR-705 Amendment 3,
// code quality audit C2 D1-P2-3 and D1-P2-5): the store reports its work, the
// capture-phase Ctrl+. sends the Moshi estop, and project replacement and the
// blocking dialogs treat it as a running job. Simulator only.
import { afterEach, describe, expect, it } from 'vitest';
import { MoshiSimulator } from '../../__fixtures__/controllers/moshi-simulator';
import { encodeMoshiJob } from '../../core/controllers/moshi';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { installAbortShortcut } from '../laser/use-job-shortcuts';
import { jobAwareConfirm } from './job-aware-dialogs';
import {
  activeLinkMachineWork,
  anyMachineJobActive,
  resetLinkMachineWorkForTests,
} from './link-machine-work';
import { resetMoshiUsbStoreForTests, useMoshiUsbStore } from './moshi-usb/moshi-usb-store';
import type { MoshiUsbConnection, MoshiUsbJob } from './moshi-usb/moshi-usb-types';
import { testLinkJobOutcome } from './link-job-outcome-test-helpers';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#f00',
      power: 60,
      speed: 1200,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 50, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function compiled(): MoshiUsbJob {
  const result = encodeMoshiJob(JOB, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' });
  if (!result.ok) throw new Error(result.error.kind);
  return {
    programs: result.programs.map((program) => program.bytes),
    footprint: result.footprint,
    ...testLinkJobOutcome(['Layer L1: a warning']),
    framingFeedMmPerMin: 3000,
  };
}

function connection(board: MoshiSimulator): MoshiUsbConnection {
  return {
    writeData: board.writeData,
    writeAddress: board.writeAddress,
    readStatus: board.readStatus,
    label: 'simulated CH341',
    onDisconnect: () => () => undefined,
    close: async () => undefined,
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function until(test: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !test(); i += 1) await tick();
  if (!test()) throw new Error('condition never held');
}

afterEach(() => {
  resetMoshiUsbStoreForTests();
  resetLinkMachineWorkForTests();
});

describe('a Moshi job in the app-wide guards', () => {
  it('reports its work, and Ctrl+. sends the estop', async () => {
    // The board stays busy until stopped, so the job is still running when Ctrl+. comes.
    const board = new MoshiSimulator({ busyReads: 1_000_000 });
    const store = useMoshiUsbStore;
    await store.getState().connect(async () => connection(board), { wait: tick });
    const job = compiled();
    store.setState({ framed: job.footprint });
    const running = store.getState().start(job);
    await until(
      () => store.getState().phase === 'running' && board.events.some((e) => e.kind === 'epilogue'),
    );

    const work = activeLinkMachineWork();
    expect(work).toMatchObject({ controller: 'Moshiboard', activity: 'running' });
    expect(work?.advisories).toEqual(['Layer L1: a warning']);
    expect(anyMachineJobActive()).toBe(true);
    expect(jobAwareConfirm('Replace the project?')).toBe(false);

    const remove = installAbortShortcut(window);
    try {
      const key = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, cancelable: true });
      window.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      await running;
      await until(() => store.getState().phase === 'idle');
    } finally {
      remove();
    }
    expect(board.events.some((event) => event.kind === 'estop')).toBe(true);
    expect(activeLinkMachineWork()).toBeNull();
    expect(anyMachineJobActive()).toBe(false);
  });

  it('reports the Frame with the job warnings, and nothing once idle', async () => {
    const board = new MoshiSimulator();
    const store = useMoshiUsbStore;
    await store.getState().connect(async () => connection(board), { wait: tick });
    const framing = store.getState().frame(compiled());
    expect(activeLinkMachineWork()).toMatchObject({
      activity: 'framing',
      advisories: ['Layer L1: a warning'],
    });
    await framing;
    expect(activeLinkMachineWork()).toBeNull();
    // The warnings stay in the panel after the Frame, before Start.
    expect(store.getState().advisories).toEqual(['Layer L1: a warning']);
  });
});
