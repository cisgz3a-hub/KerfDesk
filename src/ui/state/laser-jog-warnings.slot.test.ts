// Jog warnings share one toast slot that is rewritten in place (annoyance
// audit A5-P2-2, ADR-708). They stay warn-only (ADR-232): this file checks
// what is said and logged; the jog tests beside it check the move is still sent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { JOG_POLICY_TOAST_KEY, warnJogMotionPolicy } from './laser-jog-warnings';
import { useLaserStore } from './laser-store';
import { useNoticeHistory } from './notice-history';
import { useStore } from './store';
import { useToastStore } from './toast-store';

const set = useLaserStore.setState as Parameters<typeof warnJogMotionPolicy>[0];
const get = useLaserStore.getState;
const toasts = (): ReturnType<typeof useToastStore.getState>['toasts'] =>
  useToastStore.getState().toasts;
const policyLog = (): ReadonlyArray<string> =>
  useLaserStore.getState().log.filter((line) => line.startsWith('[lf2] '));

function configureBed(noGoZones: ReadonlyArray<unknown> = []): void {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, origin: 'rear-left', bedWidth: 400, bedHeight: 300, noGoZones },
    } as typeof project,
  });
}

beforeEach(() => {
  configureBed();
  useLaserStore.setState({ statusReport: null, homingState: 'unknown', log: [] });
  useNoticeHistory.getState().clearNotices();
});
afterEach(() => {
  for (const toast of toasts()) useToastStore.getState().dismissToast(toast.id);
  useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
});

describe('jog warning slot', () => {
  it('shows ten jogs with an unknown position as one toast, and logs each in full', () => {
    for (let click = 0; click < 10; click += 1)
      warnJogMotionPolicy(set, get, { dx: 1, feed: 1000 });

    expect(toasts()).toHaveLength(1);
    const [toast] = toasts();
    expect(toast).toMatchObject({ variant: 'warning', key: JOG_POLICY_TOAST_KEY });
    expect(toast?.message).toBe(
      'The machine XY position is unresolved, so this jog is not checked against the configured bounds or no-go zones. It is sent unchanged.',
    );
    // About half the 249 characters the log line keeps.
    expect(toast?.message.length).toBeLessThan(140);
    expect(policyLog()).toHaveLength(10);
    expect(policyLog()[0]).toBe(
      '[lf2] The current machine XY position is unresolved, so KerfDesk cannot compare this jog path with configured bounds or no-go zones. The requested controller jog will be sent unchanged; monitor the move and use Cancel Jog or the physical E-stop if needed.',
    );
    expect(useNoticeHistory.getState().notices).toHaveLength(1);
    expect(useNoticeHistory.getState().notices[0]?.count).toBe(10);
  });

  it('keeps the changing target out of the toast, so queued steps past the edge collapse', () => {
    for (let step = 1; step <= 5; step += 1) {
      warnJogMotionPolicy(set, get, { dx: 1, feed: 1000 }, { x: 400 + step, y: 10 });
    }

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.message).toBe(
      'Jog target is outside the configured machine bounds X0.000..400.000, Y0.000..300.000. Controller limits still apply.',
    );
    // The log still names every target.
    expect(policyLog()).toEqual(
      [402, 403, 404, 405, 406].map(
        (x) =>
          `[lf2] Jog target X${x}.000 Y10.000 is outside the configured machine bounds X0.000..400.000, Y0.000..300.000. Controller limits still apply.`,
      ),
    );
    expect(useNoticeHistory.getState().notices).toHaveLength(1);
  });

  it('says both findings of one jog in the slot, so the second cannot hide the first', () => {
    configureBed([
      { id: 'clamp', name: 'Clamp', enabled: true, x: 390, y: 0, width: 5, height: 300 },
    ]);

    warnJogMotionPolicy(set, get, { dx: 30, feed: 1000 }, { x: 380, y: 10 });

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.message).toBe(
      'Jog target is outside the configured machine bounds X0.000..400.000, Y0.000..300.000. Controller limits still apply. ' +
        'This jog path crosses the configured no-go zone "Clamp". It is sent unchanged; use Cancel Jog to stop it.',
    );
    expect(policyLog()).toHaveLength(2);
    expect(policyLog()[1]).toMatch(
      /^\[lf2\] This jog path crosses the configured no-go zone "Clamp"\. The requested controller jog will be sent unchanged; monitor the move/,
    );
  });

  // ADR-585 Amendment 3: a remote jog's receipt repeats what the PC showed.
  it('returns the on-screen text of each finding, which joined is the toast', () => {
    configureBed([
      { id: 'clamp', name: 'Clamp', enabled: true, x: 390, y: 0, width: 5, height: 300 },
    ]);

    const returned = warnJogMotionPolicy(set, get, { dx: 30, feed: 1000 }, { x: 380, y: 10 });

    expect(returned).toHaveLength(2);
    expect(returned.join(' ')).toBe(toasts()[0]?.message);
    expect(warnJogMotionPolicy(set, get, { dx: -1, feed: 1000 }, { x: 200, y: 10 })).toEqual([]);
  });

  it('rewrites the slot when the next jog finds something else', () => {
    warnJogMotionPolicy(set, get, { dx: 1, feed: 1000 });
    const first = toasts()[0]?.id;
    warnJogMotionPolicy(set, get, { dx: 1, feed: 1000 }, { x: 400, y: 10 });

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.id).toBe(first);
    expect(toasts()[0]?.message).toMatch(/^Jog target is outside the configured machine bounds/);
  });

  it('says nothing for a jog inside the bounds, and leaves an earlier warning to run out', () => {
    warnJogMotionPolicy(set, get, { dx: 1, feed: 1000 }, { x: 400, y: 10 });
    warnJogMotionPolicy(set, get, { dx: -1, feed: 1000 }, { x: 200, y: 10 });
    expect(toasts()).toHaveLength(1);
    expect(policyLog()).toHaveLength(1);
  });
});
