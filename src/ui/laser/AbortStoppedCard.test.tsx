// The Alarm 3 card after the operator's own Abort (UX audit U4-P2-3, ADR-341
// Amendment 11): what it says on each controller, and that only the operator's
// Abort gets it.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import {
  AbortStoppedCard,
  ABORT_SET_ORIGIN_HERE_NOTE,
  ABORT_STOPPED_TITLE,
} from './AbortStoppedCard';
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
  vi.mocked(restoreOriginAfterAbort).mockClear();
});

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

  it('shows a failed restore in place', async () => {
    vi.mocked(restoreOriginAfterAbort).mockRejectedValueOnce(new Error('no Idle'));
    const view = await render(card());
    await act(async () => view.host.querySelector('button')?.click());
    expect(view.host.textContent).toContain('no Idle');
    await view.unmount();
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
