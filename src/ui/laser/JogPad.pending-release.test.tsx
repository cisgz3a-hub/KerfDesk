// Regression test for audit finding jog-home-origin-2, driven through the real
// JogPad and laser store: releasing a held arrow while the continuous jog is
// still proving fresh Idle must leave nothing moving. GRBL ignores the
// jog-cancel byte outside the Jog state
// (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands), so the only safe
// outcome is that the boundary-length $J= is never written.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import {
  connectWith,
  getMotionOperation,
  makeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { JogPad } from './JogPad';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE_AT_100 = '<Idle|MPos:100.000,100.000,0.000|FS:0,0>';

async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    lastWriteError: null,
    safetyNotice: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    wcoCache: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  useStore.setState({ project: createProject() });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
});

describe('JogPad hold released before the continuous jog is sent', () => {
  it('never writes the boundary jog once the operator let go', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
    connection.emitLine(IDLE_AT_100);
    await drain();
    useStore.getState().updateDeviceProfile({
      origin: 'front-left',
      bedWidth: 400,
      bedHeight: 400,
      maxFeed: 6000,
    });
    useJogControlPreferences.setState({ stepMm: 10, requestedFeedMmPerMin: 3000 });

    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<JogPad disabled={false} />);
    });
    try {
      const right = [...host.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === 'Jog +X 10 mm',
      );
      if (right === undefined) throw new Error('right jog button missing');

      // The cached Idle ages past the freshness window, as between idle polls.
      const realNow = Date.now.bind(Date);
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5_000);
      writes.length = 0;
      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      });
      // After the hold delay the pad asks the store for a continuous jog, which
      // first queries status.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 320));
      });
      await vi.waitFor(() => expect(writes).toContain('?'));
      expect(getMotionOperation()).toBeNull();

      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
      });
      await vi.waitFor(() => expect(writes).toContain(RT_JOG_CANCEL));

      // The controller answers the jog's status query only now.
      await act(async () => {
        connection.emitLine(IDLE_AT_100);
        await drain();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await drain();
      });

      expect(writes.filter((write) => write.startsWith('$J='))).toEqual([]);
      expect(getMotionOperation()).toBeNull();
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });
});
