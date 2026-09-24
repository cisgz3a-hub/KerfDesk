// A controller action the store refuses must say so. Every rail control used to
// drop the rejection with `.catch(() => undefined)`, so a refused Jog, Home or
// override looked like a dead button (controller audit 2026-09-23, ui-panel-1 /
// regressions-3). The oracle is the toast the operator sees and the absence of
// any `$J=` on the wire.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { OriginTransactionCancelledError } from '../state/laser-origin-transaction';
import { useLaserStore } from '../state/laser-store';
import { connectWith, makeConnection } from '../state/laser-store-motion-operation.test-support';
import { MANUAL_MOTION_CANCELLED_MESSAGE } from '../state/manual-motion-intent';
import { useToastStore } from '../state/toast-store';
import { JogPad } from './JogPad';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';
import { reportControllerActionFailure } from './report-controller-action-failure';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

afterEach(async () => {
  vi.restoreAllMocks();
  useToastStore.setState({ toasts: [] });
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

describe('reportControllerActionFailure', () => {
  it('names the action and the store reason', () => {
    reportControllerActionFailure('Home', new Error('Machine must be known Idle or Alarm.'));
    expect(toastMessages()).toEqual(['Home: Machine must be known Idle or Alarm.']);
    expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
  });

  it('does not stack the same refusal while it is still on screen', () => {
    const error = new Error('Wait for the previous controller write.');
    reportControllerActionFailure('Jog', error);
    reportControllerActionFailure('Jog', error);
    expect(toastMessages()).toEqual(['Jog: Wait for the previous controller write.']);
  });

  it('stays quiet for deliberate cancellations', () => {
    reportControllerActionFailure('Jog', new Error(MANUAL_MOTION_CANCELLED_MESSAGE));
    reportControllerActionFailure(
      'Jog',
      new Error('Jog was cancelled or replaced before its first command was dispatched.'),
    );
    reportControllerActionFailure('Set origin', new OriginTransactionCancelledError());
    expect(toastMessages()).toEqual([]);
  });
});

describe('JogPad refusal', () => {
  it('shows why a jog click did nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
    connection.emitLine('<Idle|MPos:100.000,100.000,0.000|FS:0,0>');
    await drain();
    // A console line still owes its acknowledgement, so the store refuses jogs.
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
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
      writes.length = 0;
      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        right.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
        await drain();
      });

      await vi.waitFor(() =>
        expect(toastMessages()).toContain(
          'Jog: Wait for the previous controller write and acknowledgement to settle before jogging.',
        ),
      );
      expect(writes.filter((write) => write.startsWith('$J='))).toEqual([]);
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });
});
