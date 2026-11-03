// UX audit U4 (2026-11-03), against the GRBL simulator with the real store,
// checkpoint tracker and Frame:
// - U4-P2-3: after ABORT JOB the Alarm 3 card says the operator stopped it and
//   puts the origin the reset cleared back, so the re-run frames where the
//   first run did (ADR-341 Amendment 11).
// - U4-P2-5: after an Unlock from the rail or the Console, Frame names Home
//   and Set origin here instead of waiting for a report that cannot come
//   (ADR-367 Amendment 2).
// - U4-P2-4: a never-homed GRBL Frame past the bed edge is warned and still
//   sent unchanged (ADR-232 Amendment 2).

import { describe, expect, it, vi } from 'vitest';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { abortStoppedDetail } from './AbortStoppedCard';
import { operatorAbortAlarm, restoreOriginAfterAbort } from './abort-alarm-recovery';
import { FRAME_BED_ASSUMED_CORNER_NOTE } from '../state/frame-bed-edge-warning';
import { positionWithheldFrameMessage } from './frame-position-withheld';
import { useStartBlockerStore } from './start-blocker-store';
import { runFrameNow } from './use-frame-action';
import {
  drive,
  frameUntilPermit,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ORIGIN = { x: 20, y: 30 };

async function setOriginAt(point: { readonly x: number; readonly y: number }): Promise<void> {
  await drive(useLaserStore.getState().jog({ dx: point.x, dy: point.y, feed: 3_000 }));
  await tick(1_500);
  await drive(useLaserStore.getState().setOriginHere());
  await tick(1_500);
}

/** The Frame's motion lines (jogs), realtime bytes removed. */
function frameJogs(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return lines.filter((line) => line.startsWith('$J='));
}

function setHoming(enabled: boolean): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled } },
    },
  });
}

describe('U4-P2-3: Abort, then Restore saved origin', () => {
  it(
    'offers the cleared origin back and the re-run frames where the first one did',
    async () => {
      const h = await harness();
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await setOriginAt(ORIGIN);
      const firstFrameFrom = h.simulator.outbound().length;
      const { running } = await startFramedJob(h.repository);
      const firstFrame = frameJogs(programLines(h.simulator, firstFrameFrom));
      expect(firstFrame.length).toBeGreaterThan(0);
      await tick(600);

      await drive(useLaserStore.getState().stopJob('operator'));
      await drive(running).catch(() => undefined);
      await tick(1_500);
      // The reset cleared the G92 origin; the head stopped somewhere in the job.
      expect(useLaserStore.getState().alarmCode).toBe(3);
      expect(totalWco(h.simulator.state())).toMatchObject({ x: 0, y: 0 });
      const abort = operatorAbortAlarm(useLaserStore.getState());
      expect(abort?.originAtStopMm).toEqual(ORIGIN);
      const stoppedAt = h.simulator.state().mpos;

      await drive(restoreOriginAfterAbort(ORIGIN, false));
      expect(useLaserStore.getState().alarmCode).toBeNull();
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
      expect(useLaserStore.getState()).toMatchObject({
        workOriginActive: true,
        workOriginSource: 'g92',
        positionEvidenceSuppressed: false,
      });
      // Restore does not move the head.
      expect(h.simulator.state().mpos).toEqual(stoppedAt);

      const secondFrameFrom = h.simulator.outbound().length;
      await frameUntilPermit();
      // The same work-coordinate outline from the same origin: the same place.
      // Only a return leg follows, back to where the Abort left the head.
      const secondFrame = frameJogs(programLines(h.simulator, secondFrameFrom));
      expect(secondFrame.slice(0, firstFrame.length)).toEqual(firstFrame);
      expect(secondFrame.length).toBe(firstFrame.length + 1);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('U4-P2-3 on grblHAL, which keeps a G92 origin through a reset', () => {
  it(
    'says the origin was kept, and Restore re-confirms the same one',
    async () => {
      const h = await harness({
        simulator: {
          firmware: 'grblhal',
          firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
        },
      });
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await setOriginAt(ORIGIN);
      const { running } = await startFramedJob(h.repository);
      await tick(600);
      await drive(useLaserStore.getState().stopJob('operator'));
      await drive(running).catch(() => undefined);
      await tick(1_500);

      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
      const abort = operatorAbortAlarm(useLaserStore.getState());
      expect(abort?.originAtStopMm).toEqual(ORIGIN);
      expect(abortStoppedDetail(ORIGIN, 'grblhal', false)).toContain('grblHAL keeps your origin');

      await drive(restoreOriginAfterAbort(ORIGIN, false));
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
      expect(useLaserStore.getState().workOriginSource).toBe('g92');
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('U4-P2-5: Frame after an Unlock names the way out', () => {
  it(
    'after the rail Unlock, on a machine with homing, names Home and Set origin here',
    async () => {
      const h = await harness();
      setHoming(true);
      useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
      h.simulator.triggerAlarm(3);
      await tick(1_500);
      await drive(useLaserStore.getState().unlockAlarm());
      await tick(1_500);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(await drive(runFrameNow(), 30_000)).toBe(false);
        expect(useStartBlockerStore.getState().messages).toEqual([
          positionWithheldFrameMessage(true),
        ]);
      }
      expect(positionWithheldFrameMessage(true)).toContain('Home the machine');
      expect(positionWithheldFrameMessage(true)).toContain('Set origin here');
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'after $X typed in the Console, without homing, names Set origin here and not Home',
    async () => {
      const h = await harness();
      useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
      h.simulator.triggerAlarm(3);
      await tick(1_500);
      await drive(useLaserStore.getState().sendConsoleCommand('$X'));
      await tick(1_500);
      expect(useLaserStore.getState().positionEvidenceSuppressed).toBe(true);

      expect(await drive(runFrameNow(), 30_000)).toBe(false);
      const [message] = useStartBlockerStore.getState().messages;
      expect(message).toBe(positionWithheldFrameMessage(false));
      expect(message).not.toContain('Home');
      expect(message).not.toContain('Wait for');

      // The named remedy works: Set origin here, then the Frame runs.
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);
      await frameUntilPermit();
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('U4-P2-4: a never-homed GRBL Frame past the bed edge', () => {
  it(
    'warns as it sends the Frame unchanged, and says what the check assumes',
    async () => {
      const h = await harness();
      const project = useStore.getState().project;
      useStore.setState({
        project: { ...project, device: { ...project.device, bedWidth: 100, bedHeight: 100 } },
        jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
      });
      await setOriginAt({ x: 10, y: 10 });
      useToastStore.setState({ toasts: [] });
      const onBedFrom = h.simulator.outbound().length;
      await frameUntilPermit();
      const onBed = frameJogs(programLines(h.simulator, onBedFrom));
      expect(useToastStore.getState().toasts.some((t) => t.variant === 'warning')).toBe(false);

      // 70 mm further: the 4..30 × 4..42 mm job now reaches X 110, Y 122.
      await drive(useLaserStore.getState().jog({ dx: 70, dy: 70, feed: 3_000 }));
      await tick(1_500);
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);
      useToastStore.setState({ toasts: [] });
      const offBedFrom = h.simulator.outbound().length;
      await frameUntilPermit();

      const warning = useToastStore
        .getState()
        .toasts.find((toast) => toast.variant === 'warning')?.message;
      expect(warning).toContain('past the edge of the 100 × 100 mm bed');
      expect(warning).toContain(FRAME_BED_ASSUMED_CORNER_NOTE);
      expect(warning).toContain('The Frame is sent unchanged');
      // A warning, not a guard (ADR-228): the same Frame lines, the permit kept,
      // and Job Review gets the finding.
      expect(frameJogs(programLines(h.simulator, offBedFrom))).toEqual(onBed);
      expect(useLaserStore.getState().framedRun?.candidate.frameNoGoWarnings).toEqual([warning]);
    },
    STRESS_TIMEOUT_MS,
  );
});
