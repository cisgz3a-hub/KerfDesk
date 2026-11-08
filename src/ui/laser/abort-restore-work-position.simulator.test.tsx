// Rolling audit v10 V3-P2-2, against the GRBL simulator with the real store and
// checkpoint tracker: the Abort card's Restore saved origin on a GRBL set to
// $10=0, whose reports carry WPos and, on one Idle report in ten, WCO
// (ADR-341 Amendment 12).
// - Restore saved origin and Home, then restore origin put the origin back.
// - When no report carries WCO, the failure is the card's toast, with a message
//   that says why, not a silent no-op.
// - The next Frame then names the unrestored origin and the head's distance
//   from it, and its OK puts that origin back, not one at the head (the V9
//   refuter's P1 re-rate).
// - $10=1 (MPos on every report) is the control.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type * as Controllers from '../../__fixtures__/controllers';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { RESTORE_ORIGIN_WORK_POSITION_ONLY_MESSAGE } from '../state/laser-origin-restore';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { AbortStoppedCard } from './AbortStoppedCard';
import { operatorAbortAlarm, restoreOriginAfterAbort } from './abort-alarm-recovery';
import {
  drive,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

/** How the simulated controller's status reports are shaped. */
const reports = { workPosition: false, wcoNever: false, wcoShown: 0, wcoHidden: 0 };

vi.mock('../../__fixtures__/controllers', async (importOriginal) => {
  const actual = await importOriginal<typeof Controllers>();
  return {
    ...actual,
    createGrblSimulator: (options: Parameters<typeof actual.createGrblSimulator>[0] = {}) => {
      const simulator = actual.createGrblSimulator(options);
      return reports.workPosition
        ? { ...simulator, adapter: workPositionAdapter(simulator.adapter) }
        : simulator;
    },
  };
});

type Adapter = ReturnType<typeof Controllers.createGrblSimulator>['adapter'];

const BUSY_STATES = new Set(['Run', 'Hold', 'Jog', 'Home', 'Door']);

// GRBL 1.1 with $10=0 (report.c): WPos = MPos - WCO on every report, and WCO:
// on the first report after a soft reset or a G10/G92, then once every 10
// reports at Idle or every 30 while busy.
function workPositionReports(): {
  readonly sent: (data: string) => void;
  readonly shape: (line: string) => string;
} {
  let countdown = 0;
  return {
    sent: (data) => {
      if (data.includes(String.fromCharCode(0x18)) || /G92|G10/.test(data)) countdown = 0;
    },
    shape: (line) => {
      if (!line.startsWith('<')) return line;
      const fields = line.slice(1, -1).split('|');
      const vector = (name: string): number[] | null => {
        const field = fields.find((item) => item.startsWith(`${name}:`));
        return field === undefined
          ? null
          : field
              .slice(name.length + 1)
              .split(',')
              .map(Number);
      };
      const mpos = vector('MPos');
      if (mpos === null) return line;
      const wco = vector('WCO') ?? [0, 0, 0];
      let showWco = false;
      if (countdown > 0) countdown -= 1;
      else {
        countdown = BUSY_STATES.has(fields[0]?.split(':')[0] ?? '') ? 29 : 9;
        showWco = !reports.wcoNever;
      }
      if (showWco) reports.wcoShown += 1;
      else reports.wcoHidden += 1;
      const wpos = mpos.map((value, axis) => (value - (wco[axis] ?? 0)).toFixed(3)).join(',');
      const shaped = fields
        .filter((field) => showWco || !field.startsWith('WCO:'))
        .map((field) => (field.startsWith('MPos:') ? `WPos:${wpos}` : field));
      return `<${shaped.join('|')}>`;
    },
  };
}

function workPositionAdapter(adapter: Adapter): Adapter {
  return {
    ...adapter,
    serial: {
      ...adapter.serial,
      requestPort: async () => {
        const port = await adapter.serial.requestPort();
        if (port === null) return null;
        return {
          ...port,
          open: async (options: Parameters<typeof port.open>[0]) => {
            const connection = await port.open(options);
            const shaper = workPositionReports();
            return {
              ...connection,
              write: async (data: string) => {
                shaper.sent(data);
                return connection.write(data);
              },
              onLine: (handler: (line: string) => void) =>
                connection.onLine((line) => handler(shaper.shape(line))),
            };
          },
        };
      },
    },
  } as Adapter;
}

installRecoveryStressHooks();

const ORIGIN = { x: 20, y: 30 };

function setHoming(enabled: boolean): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled } },
    },
  });
}

async function setOriginAt(point: { readonly x: number; readonly y: number }): Promise<void> {
  await drive(useLaserStore.getState().jog({ dx: point.x, dy: point.y, feed: 3_000 }));
  for (let step = 0; step < 100 && useLaserStore.getState().motionOperation !== null; step += 1) {
    await tick(100);
  }
  await tick(1_500);
  await drive(useLaserStore.getState().setOriginHere());
  await tick(1_500);
}

/** Set the origin, start a framed job and press ABORT JOB: the card's state. */
async function abortWithOrigin(options: { readonly homing: boolean }) {
  reports.wcoShown = 0;
  reports.wcoHidden = 0;
  const h = await harness();
  setHoming(options.homing);
  useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
  if (options.homing) {
    await drive(useLaserStore.getState().home(), 30_000);
    await tick(1_500);
  }
  await setOriginAt(ORIGIN);
  const { running } = await startFramedJob(h.repository);
  await tick(600);
  await drive(useLaserStore.getState().stopJob('operator'));
  await drive(running).catch(() => undefined);
  await tick(1_500);
  expect(useLaserStore.getState().alarmCode).toBe(3);
  expect(operatorAbortAlarm(useLaserStore.getState())?.originAtStopMm).toEqual(ORIGIN);
  useToastStore.setState({ toasts: [] });
  return h;
}

function g92Lines(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return lines.filter((line) => line.includes('G92'));
}

describe('V3-P2-2: Restore saved origin after Abort, $10=0 against $10=1', () => {
  for (const workPosition of [false, true]) {
    it(
      `${workPosition ? '$10=0' : '$10=1 (control)'}: Restore saved origin puts it back`,
      async () => {
        reports.workPosition = workPosition;
        try {
          const h = await abortWithOrigin({ homing: false });
          const stoppedAt = h.simulator.state().mpos;
          const from = h.simulator.outbound().length;
          await drive(restoreOriginAfterAbort(ORIGIN, false), 30_000);

          expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
          expect(g92Lines(programLines(h.simulator, from))).toHaveLength(1);
          expect(h.simulator.state().mpos).toEqual(stoppedAt);
          expect(useLaserStore.getState()).toMatchObject({
            alarmCode: null,
            workOriginSource: 'g92',
            positionEvidenceSuppressed: false,
          });
          if (workPosition) expect(reports.wcoHidden).toBeGreaterThan(reports.wcoShown);
        } finally {
          reports.workPosition = false;
        }
      },
      STRESS_TIMEOUT_MS,
    );
  }

  it(
    '$10=0: Home, then restore origin puts it back',
    async () => {
      reports.workPosition = true;
      try {
        const h = await abortWithOrigin({ homing: true });
        await drive(restoreOriginAfterAbort(ORIGIN, true), 60_000);
        expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
        expect(useLaserStore.getState()).toMatchObject({
          alarmCode: null,
          workOriginSource: 'g92',
        });
      } finally {
        reports.workPosition = false;
      }
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    '$10=0 with no report carrying WCO: the card toasts why the origin was not written',
    async () => {
      reports.workPosition = true;
      try {
        const h = await abortWithOrigin({ homing: false });
        reports.wcoNever = true;
        const from = h.simulator.outbound().length;
        const request = operatorAbortAlarm(useLaserStore.getState());
        if (request === null) throw new Error('No Abort card.');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
          root.render(
            <AbortStoppedCard
              request={request}
              controllerKind="grbl-v1.1"
              machineKind="laser"
              homingEnabled={false}
              homeFromAlarm
              canUnlock
              onHome={() => undefined}
              onUnlock={() => undefined}
            />,
          );
        });
        const restore = Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Restore saved origin',
        );
        await act(async () => restore?.click());
        for (let step = 0; step < 200 && useToastStore.getState().toasts.length === 0; step += 1) {
          await tick(50);
        }

        expect(useToastStore.getState().toasts).toEqual([
          expect.objectContaining({
            variant: 'error',
            message: `Restore saved origin: ${RESTORE_ORIGIN_WORK_POSITION_ONLY_MESSAGE}`,
          }),
        ]);
        // $X went out and nothing else: no G92, and the alarm is cleared.
        expect(g92Lines(programLines(h.simulator, from))).toEqual([]);
        expect(useLaserStore.getState().alarmCode).toBeNull();
        expect(totalWco(h.simulator.state())).toMatchObject({ x: 0, y: 0 });
        await act(async () => root.unmount());

        // GRBL sends WCO again; the operator presses Frame, as success would
        // have told them to. The offer names the saved origin, and OK restores it.
        reports.wcoNever = false;
        await tick(3_000);
        vi.mocked(jobAwareConfirm).mockClear();
        const frameFrom = h.simulator.outbound().length;
        await drive(runFrameNow(), 60_000);
        const prompt = String(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0] ?? '');
        expect(prompt).toContain(
          'The job you stopped ran from X 20, Y 30 mm from machine zero, and that origin was not restored.',
        );
        expect(prompt).toMatch(
          /The head is [\d.]+ mm from it \(X [+−]?[\d.]+, Y [+−]?[\d.]+ mm\)\./,
        );
        expect(prompt).not.toContain('set the work origin at the current head position');
        expect(g92Lines(programLines(h.simulator, frameFrom))).toHaveLength(1);
        expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
        expect(useLaserStore.getState().workOriginSource).toBe('g92');
        host.remove();
      } finally {
        reports.workPosition = false;
        reports.wcoNever = false;
      }
    },
    STRESS_TIMEOUT_MS,
  );
});
