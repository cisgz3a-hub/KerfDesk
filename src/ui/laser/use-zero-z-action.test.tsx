// A second Zero Z at a bit-change hold (ADR-416 Amendment 4). The overwrite
// question used to be a native confirm, which is refused for the whole of a
// job: with the bit away from the first zero, Zero Z was dropped with an
// unrelated toast and the hold could not be finished. It is asked in the app
// now (ADR-707), during a hold too, and a yes counts only for the question as
// it still stands.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppDialogStore } from '../state/app-dialog-store';
import { JOB_ACTIVE_CONFIRM_BLOCKED } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState, isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import {
  useZeroZAction,
  ZERO_Z_CHANGED_WHILE_ASKED_MESSAGE,
  ZERO_Z_OVERWRITE_BUTTON,
  ZERO_Z_OVERWRITE_TITLE,
} from './use-zero-z-action';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Laser = ReturnType<typeof useLaserStore.getState>;

function statusAt(workZMm: number): Laser['statusReport'] {
  return {
    state: 'Idle',
    subState: null,
    mPos: null,
    wPos: { x: 0, y: 0, z: workZMm },
    wco: null,
    feed: 0,
    spindle: 0,
  } as unknown as Laser['statusReport'];
}

let zeroZHere: ReturnType<typeof vi.fn<() => Promise<void>>>;
let press: () => Promise<void>;
let unmount: () => Promise<void>;

/** A settled bit-change hold whose first Zero Z was taken 3 mm above the bit. */
beforeEach(async () => {
  zeroZHere = vi.fn<() => Promise<void>>(async () => undefined);
  useLaserStore.setState({
    ...initialLaserState(),
    zeroZHere,
    streamer: { status: 'tool-change', inFlight: [] } as unknown as Laser['streamer'],
    toolChangeIdleSeen: true,
    workZReferenceEpoch: 3,
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 3, toolId: 'em-6350' },
    statusReport: statusAt(-3),
  });
  useAppDialogStore.setState({ queue: [] });
  useToastStore.setState({ toasts: [] });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  function ZeroZButton(): JSX.Element {
    const zeroZ = useZeroZAction();
    return (
      <button type="button" onClick={zeroZ}>
        Zero Z
      </button>
    );
  }
  await act(async () => root.render(<ZeroZButton />));
  press = async () => act(async () => host.querySelector('button')?.click());
  unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
});

afterEach(async () => {
  await unmount();
  useLaserStore.setState(initialLaserState());
  useAppDialogStore.setState({ queue: [] });
  useToastStore.setState({ toasts: [] });
});

function openQuestion() {
  const request = useAppDialogStore.getState().queue[0];
  if (request?.kind !== 'confirm') throw new Error('Expected the overwrite question');
  return request;
}

async function answer(confirmed: boolean): Promise<void> {
  const request = openQuestion();
  await act(async () => request.resolve({ confirmed, dontAskAgain: false }));
}

function toasts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe('Zero Z over an existing zero at a bit-change hold', () => {
  it('asks in the app while the job is held, and a yes zeroes', async () => {
    expect(isActiveJob(useLaserStore.getState().streamer)).toBe(true);
    await press();
    const { options } = openQuestion();
    expect(options.title).toBe(ZERO_Z_OVERWRITE_TITLE);
    expect(options.confirmLabel).toBe(ZERO_Z_OVERWRITE_BUTTON);
    expect(options.message).toContain('3.0 mm below that zero');
    // Not refused for the job, and Enter on its way elsewhere cannot press yes.
    expect(options.refuseDuringJob).toBeUndefined();
    expect(options.initialFocus).toBe('surface');
    expect(zeroZHere).not.toHaveBeenCalled();
    expect(toasts()).not.toContain(JOB_ACTIVE_CONFIRM_BLOCKED);

    await answer(true);
    expect(zeroZHere).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(['Work Z0 set at the current bit height (G92 Z0).']);
  });

  it('sends nothing on Cancel', async () => {
    await press();
    await answer(false);
    expect(zeroZHere).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  it('does not count a yes once the bit has moved under the open question', async () => {
    await press();
    await act(async () => useLaserStore.setState({ statusReport: statusAt(-7) }));
    await answer(true);
    expect(zeroZHere).not.toHaveBeenCalled();
    expect(toasts()).toEqual([ZERO_Z_CHANGED_WHILE_ASKED_MESSAGE]);
  });

  it('asks nothing with the bit at the existing zero', async () => {
    await act(async () => useLaserStore.setState({ statusReport: statusAt(0.2) }));
    await press();
    expect(useAppDialogStore.getState().queue).toHaveLength(0);
    expect(zeroZHere).toHaveBeenCalledTimes(1);
  });
});
