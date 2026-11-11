// The Alarm 3 card after the operator's own Abort (UX audit U4-P2-3, ADR-341
// Amendment 11): what it says on each controller, and that only the operator's
// Abort gets it. A failure after the unlock is a toast, since the card is gone
// by then (rolling audit v10 V3-P2-2).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  AbortStoppedCard,
  ABORT_AUTO_RESTORE_RUNNING_NOTE,
  ABORT_SET_ORIGIN_HERE_NOTE,
  ABORT_STOPPED_TITLE,
} from './AbortStoppedCard';
import { installAbortAutoRestore, useAbortAutoRestoreStore } from './abort-auto-restore';
import { AlarmCard } from './AlarmBanner';
import { operatorAbortAlarm, restoreOriginAfterAbort } from './abort-alarm-recovery';
import type * as AbortAlarmRecovery from './abort-alarm-recovery';

vi.mock('./abort-alarm-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof AbortAlarmRecovery>()),
  restoreOriginAfterAbort: vi.fn(async () => undefined),
  setOriginHereAfterAbort: vi.fn(async () => undefined),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();
const SAVED = { x: 20, y: 30 };
const REQUEST = { reason: 'operator', streamerEpoch: 4, originAtStopMm: SAVED } as const;

async function render(node: JSX.Element): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(node);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function buttons(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('button')).map((button) => button.textContent ?? '');
}

function card(overrides: Partial<Parameters<typeof AbortStoppedCard>[0]> = {}): JSX.Element {
  return (
    <AbortStoppedCard
      request={REQUEST}
      controllerKind="grbl-v1.1"
      machineKind="laser"
      homingEnabled={false}
      homeFromAlarm
      canUnlock
      onHome={() => undefined}
      onUnlock={() => undefined}
      {...overrides}
    />
  );
}

afterEach(() => {
  useLaserStore.setState(original, true);
  useToastStore.setState({ toasts: [] });
  vi.mocked(restoreOriginAfterAbort).mockClear();
});

/** The store while the operator's Abort still holds ALARM:3, so the card shows. */
function holdAbortAlarm(): void {
  useLaserStore.setState({
    alarmCode: 3,
    streamerEpoch: 4,
    jobStopRequest: REQUEST,
    streamReset: { streamerEpoch: 4, positionMayBeLost: true },
  });
}

describe('operatorAbortAlarm', () => {
  const base = {
    alarmCode: 3,
    streamerEpoch: 4,
    jobStopRequest: REQUEST,
    streamReset: { streamerEpoch: 4, positionMayBeLost: true },
  };

  it("is the operator's Abort for the ALARM:3 its reset raised", () => {
    expect(operatorAbortAlarm(base)).toBe(REQUEST);
  });

  it('is null for another alarm, an app-closing stop, or an earlier stream', () => {
    expect(operatorAbortAlarm({ ...base, alarmCode: 1 })).toBeNull();
    expect(
      operatorAbortAlarm({ ...base, jobStopRequest: { reason: 'app-closing', streamerEpoch: 4 } }),
    ).toBeNull();
    expect(operatorAbortAlarm({ ...base, streamerEpoch: 5 })).toBeNull();
  });

  it('is null after a Marlin Abort, which stops without a reset', () => {
    expect(operatorAbortAlarm({ ...base, streamReset: null })).toBeNull();
  });
});

describe('AbortStoppedCard', () => {
  it('on stock GRBL without homing says what happened and offers the origin back', async () => {
    const view = await render(card());
    const text = view.host.textContent ?? '';
    expect(text).toContain(ABORT_STOPPED_TITLE);
    expect(text).toContain('The laser is off.');
    expect(text).toContain(
      'so your origin was cleared. It was at X 20, Y 30 mm from machine zero.',
    );
    expect(text).toContain(ABORT_SET_ORIGIN_HERE_NOTE);
    expect(text).not.toMatch(/home/i);
    expect(buttons(view.host)).toEqual(['Restore saved origin', 'Set origin here', '$X — Unlock']);
    await view.unmount();
  });

  it('on a machine with homing homes first, then restores', async () => {
    const view = await render(card({ homingEnabled: true }));
    expect(buttons(view.host)[0]).toBe('Home, then restore origin');
    await act(async () => view.host.querySelector('button')?.click());
    expect(restoreOriginAfterAbort).toHaveBeenCalledWith(SAVED, true);
    await view.unmount();
  });

  it('on grblHAL says the origin was kept', async () => {
    const view = await render(card({ controllerKind: 'grblhal' }));
    expect(view.host.textContent).toContain('grblHAL keeps your origin');
    expect(view.host.textContent).not.toContain('cleared');
    await view.unmount();
  });

  it('on a GRBL CNC says work Z must be zeroed again', async () => {
    const view = await render(card({ machineKind: 'cnc' }));
    expect(view.host.textContent).toContain('The reset cleared work Z too: zero Z again.');
    await view.unmount();
  });

  it('without a saved origin offers Unlock, and Home only when homing is on', async () => {
    const request = { reason: 'operator', streamerEpoch: 4 } as const;
    const plain = await render(card({ request }));
    expect(buttons(plain.host)).toEqual(['$X — Unlock']);
    expect(plain.host.textContent).not.toMatch(/home/i);
    await plain.unmount();
    const homing = await render(card({ request, homingEnabled: true }));
    expect(buttons(homing.host)).toEqual(['Home ($H)', '$X — Unlock']);
    await homing.unmount();
  });

  it('shows a restore refused before the unlock in place, while the alarm holds', async () => {
    holdAbortAlarm();
    vi.mocked(restoreOriginAfterAbort).mockRejectedValueOnce(new Error('no Idle'));
    const view = await render(card());
    await act(async () => view.host.querySelector('button')?.click());
    expect(view.host.textContent).toContain('no Idle');
    expect(useToastStore.getState().toasts).toEqual([]);
    await view.unmount();
  });

  it('toasts a restore that fails after the unlock cleared the alarm (V3-P2-2)', async () => {
    holdAbortAlarm();
    vi.mocked(restoreOriginAfterAbort).mockImplementationOnce(async () => {
      // $X went out and the controller reported Idle: the card unmounts.
      useLaserStore.setState({ alarmCode: null });
      throw new Error('The saved origin was not written.');
    });
    const view = await render(card());
    await act(async () => view.host.querySelector('button')?.click());
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'error',
        message: 'Restore saved origin: The saved origin was not written.',
      }),
    ]);
    await view.unmount();
  });
});

describe('AbortStoppedCard and the automatic restore (ADR-341 Amendment 14)', () => {
  afterEach(() => {
    useAbortAutoRestoreStore.setState({ running: null, failure: null });
  });

  it('holds its buttons and says so while the origin is being put back', async () => {
    const view = await render(card());
    await act(async () => useAbortAutoRestoreStore.setState({ running: REQUEST }));
    expect(view.host.textContent).toContain(ABORT_AUTO_RESTORE_RUNNING_NOTE);
    expect(view.host.textContent).toContain(ABORT_STOPPED_TITLE);
    const all = Array.from(view.host.querySelectorAll('button'));
    expect(all.length).toBe(3);
    expect(all.every((button) => button.disabled)).toBe(true);
    await act(async () => all[0]?.click());
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('says a failed automatic restore did not happen and keeps its buttons', async () => {
    const view = await render(card());
    await act(async () =>
      useAbortAutoRestoreStore.setState({
        failure: { request: REQUEST, reason: 'The door is open.' },
      }),
    );
    expect(view.host.textContent).toContain(
      'Your origin was not restored automatically: The door is open. Use the buttons above.',
    );
    expect(buttons(view.host)).toEqual(['Restore saved origin', 'Set origin here', '$X — Unlock']);
    expect(Array.from(view.host.querySelectorAll('button')).some((button) => button.disabled)).toBe(
      false,
    );
    await view.unmount();
  });

  it("ignores another Abort's automatic restore", async () => {
    const other = { reason: 'operator', streamerEpoch: 3 } as const;
    const view = await render(card());
    await act(async () =>
      useAbortAutoRestoreStore.setState({
        running: other,
        failure: { request: other, reason: 'old' },
      }),
    );
    expect(view.host.textContent).not.toContain(ABORT_AUTO_RESTORE_RUNNING_NOTE);
    expect(view.host.textContent).not.toContain('old');
    await view.unmount();
  });

  it('a press on Unlock keeps the recovery with the operator: no automatic restore after', async () => {
    const request = { ...REQUEST, originMachineZeroEpoch: 0, jobMachineKind: 'laser' } as const;
    const report = {
      state: 'Alarm',
      subState: null,
      mPos: { x: 41, y: 37, z: 0 },
      wPos: null,
      feed: 0,
      spindle: 0,
      wco: null,
    } as const;
    const settle = (): void => {
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        useLaserStore.setState({ statusReport: { ...report }, statusSequence: sequence });
      }
    };
    const abortedState = {
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      alarmCode: 3,
      streamerEpoch: 4,
      streamReset: { streamerEpoch: 4, positionMayBeLost: true },
      machineZeroEpoch: 0,
    } as const;
    const uninstall = installAbortAutoRestore();
    try {
      // The control: with no press, the same reports restore the origin.
      const unpressed = { ...request };
      useLaserStore.setState({ ...abortedState, jobStopRequest: unpressed });
      settle();
      await act(async () => undefined);
      expect(restoreOriginAfterAbort).toHaveBeenCalledTimes(1);
      vi.mocked(restoreOriginAfterAbort).mockClear();

      useLaserStore.setState({ ...abortedState, jobStopRequest: request, statusReport: null });
      const onUnlock = vi.fn();
      const view = await render(card({ request, onUnlock }));
      const unlock = Array.from(view.host.querySelectorAll('button')).find(
        (button) => button.textContent === '$X — Unlock',
      );
      await act(async () => unlock?.click());
      expect(onUnlock).toHaveBeenCalledTimes(1);
      settle();
      await act(async () => undefined);
      expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      uninstall();
    }
  });
});

describe('AlarmCard', () => {
  const props = {
    code: 3,
    controllerKind: 'grbl-v1.1',
    homingEnabled: false,
    homeFromAlarm: true,
    canUnlock: true,
    resetRequired: false,
    onHome: () => undefined,
    onConfigureHoming: () => undefined,
    onUnlock: () => undefined,
    onReset: () => undefined,
  } as const;

  it("keeps the ordinary Alarm 3 card for a reset that was not the operator's Abort", async () => {
    const view = await render(<AlarmCard {...props} machineKind="laser" operatorAbort={null} />);
    expect(view.host.textContent).toContain('Alarm 3: Reset during motion');
    await view.unmount();
  });

  it("shows the stopped card for the operator's Abort", async () => {
    const view = await render(<AlarmCard {...props} machineKind="laser" operatorAbort={REQUEST} />);
    expect(view.host.textContent).toContain(ABORT_STOPPED_TITLE);
    expect(view.host.textContent).not.toContain('Re-home');
    await view.unmount();
  });
});
