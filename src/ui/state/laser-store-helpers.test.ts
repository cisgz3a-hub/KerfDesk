import { describe, expect, it } from 'vitest';
import {
  createStreamer,
  idleCollector,
  step,
  type StatusReport,
} from '../../core/controllers/grbl';
import {
  buildPortClosePatch,
  CONNECT_MACHINE_FIRST,
  detectStreamStall,
  initialLaserState,
  jogFrameCommandBlockMessage,
  STREAM_STALL_RUNNING_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_MS,
  type StallProbe,
  UNKNOWN_IDLE_STATUS_MESSAGE,
} from './laser-store-helpers';
import {
  interactiveControllerOperation,
  readOnlyControllerOperation,
  type LaserControllerOperation,
} from './laser-controller-operation';
import { beginConsoleSettingsRead } from './laser-console-completion';
import { startMotionOperation } from './laser-motion-operation';
import { disconnectDuringJobNotice, disconnectDuringMotionNotice } from './laser-safety-notice';
import { useLaserStore, type LaserState } from './laser-store';
import { HOST_SCHEDULING_GAP_MS } from './laser-stream-heartbeat';

const POLL_MS = 250;

function streamingState() {
  return step(createStreamer('G1 X1 S100\nG1 X2\nG1 X3')).state;
}

function report(state: StatusReport['state']): StatusReport {
  return {
    state,
    subState: null,
    mPos: null,
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

type Streamer = ReturnType<typeof streamingState>;

// The status poll feeds the watchdog every 250 ms while the page runs; these
// walk it tick by tick so only a real scheduling gap looks like one.
function pollUntil(
  streamer: Streamer,
  statusReport: StatusReport | null,
  first: StallProbe,
  from: number,
  until: number,
): { readonly probe: StallProbe; readonly stalled: boolean } {
  let result = { probe: first, stalled: false };
  for (let now = from + POLL_MS; now <= until; now += POLL_MS) {
    result = detectStreamStall(streamer, statusReport, result.probe, now);
  }
  return result;
}

// M13 (AUDIT-2026-06-10): if GRBL stops acking mid-job there was no watchdog
// anywhere — 'streaming' at a frozen percentage indefinitely, silently.
describe('detectStreamStall (M13)', () => {
  it('flags a stall when no ack arrives and the controller has no Run status', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, null, null, 1_000);
    expect(first.stalled).toBe(false);

    const second = pollUntil(streamer, null, first.probe, 1_000, 1_000 + STREAM_STALL_TIMEOUT_MS);
    expect(second.stalled).toBe(true);
  });

  it('allows a longer watchdog window while the controller is still running', () => {
    const streamer = streamingState();
    const staleRunStatus = report('Run');
    const first = detectStreamStall(streamer, staleRunStatus, null, 1_000);
    expect(first.stalled).toBe(false);

    const second = pollUntil(
      streamer,
      staleRunStatus,
      first.probe,
      1_000,
      1_000 + STREAM_STALL_TIMEOUT_MS,
    );
    expect(second.stalled).toBe(false);

    const third = pollUntil(
      streamer,
      staleRunStatus,
      second.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS,
      1_000 + STREAM_STALL_RUNNING_TIMEOUT_MS,
    );
    expect(third.stalled).toBe(true);
  });

  it('resets the clock when the stream makes progress', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    const waited = pollUntil(streamer, null, first.probe, 1_000, 1_000 + STREAM_STALL_TIMEOUT_MS);
    // An ack arrived: completed advanced.
    const progressed = { ...streamer, completed: streamer.completed + 1 };
    const second = detectStreamStall(
      progressed,
      null,
      waited.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS + POLL_MS,
    );
    expect(second.stalled).toBe(false);
    expect(second.probe?.at).toBe(1_000 + STREAM_STALL_TIMEOUT_MS + POLL_MS);
  });

  it('does not flag a stall while fresh Run status reports keep arriving', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    const freshRunStatus = report('Run');
    const second = detectStreamStall(
      streamer,
      freshRunStatus,
      first.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS,
    );
    expect(second.stalled).toBe(false);
  });

  it('does not flag a stall during a feed hold or door state', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    const held = detectStreamStall(
      streamer,
      report('Hold'),
      first.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS * 2,
    );
    expect(held.stalled).toBe(false);
  });

  it('is inert when no job is streaming', () => {
    const probe: StallProbe = null;
    expect(detectStreamStall(null, report('Idle'), probe, 5_000).stalled).toBe(false);
  });

  // ADR-356: a page that stopped running (long task, hidden tab, sleep)
  // observed nothing in between; the controller's silence starts counting
  // again only from the tick that resumed.
  it('restarts the clock after a host scheduling gap instead of counting it as controller silence', () => {
    const streamer = streamingState();
    const staleRunStatus = report('Run');
    const first = detectStreamStall(streamer, staleRunStatus, null, 1_000);
    const afterStall = detectStreamStall(
      streamer,
      staleRunStatus,
      first.probe,
      1_000 + STREAM_STALL_RUNNING_TIMEOUT_MS + 5_000,
    );

    expect(afterStall.stalled).toBe(false);
    expect(afterStall.probe?.at).toBe(1_000 + STREAM_STALL_RUNNING_TIMEOUT_MS + 5_000);
  });

  it('still flags a controller that stays silent once the host is polling again', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, null, null, 1_000);
    const resumedAt = 1_000 + HOST_SCHEDULING_GAP_MS + 30_000;
    const afterStall = detectStreamStall(streamer, null, first.probe, resumedAt);
    const silent = pollUntil(
      streamer,
      null,
      afterStall.probe,
      resumedAt,
      resumedAt + STREAM_STALL_TIMEOUT_MS,
    );

    expect(afterStall.stalled).toBe(false);
    expect(silent.stalled).toBe(true);
  });

  it('keeps counting across ticks that are late but inside the scheduling gap', () => {
    const streamer = streamingState();
    let result = detectStreamStall(streamer, null, null, 1_000);
    const lateTick = HOST_SCHEDULING_GAP_MS - 1;
    let now = 1_000;
    while (now - 1_000 < STREAM_STALL_TIMEOUT_MS) {
      now += lateTick;
      result = detectStreamStall(streamer, null, result.probe, now);
    }

    expect(result.probe?.at).toBe(1_000);
    expect(result.stalled).toBe(true);
  });
});

// ADR-639 (amending P0-B): only a link lost while the machine may still move
// raises the E-stop banner; a read or a recovery wait lands disconnected.
describe('buildPortClosePatch safety notice', () => {
  const idle = (patch: Partial<LaserState>): LaserState => ({
    ...useLaserStore.getState(),
    ...initialLaserState(),
    connection: { kind: 'connected' },
    ...patch,
  });

  const awaitingIdle: LaserControllerOperation = {
    kind: 'recovery',
    phase: 'awaiting-idle',
    idleReports: 0,
  };

  it.each<[string, Partial<LaserState>]>([
    ['a settings read', { controllerOperation: readOnlyControllerOperation('Reading settings') }],
    [
      'a build-info read',
      { controllerOperation: readOnlyControllerOperation('Reading controller build information') },
    ],
    [
      'a reset the controller answered Idle',
      { controllerOperation: awaitingIdle, statusReport: report('Idle') },
    ],
    [
      'a reset the controller answered Alarm',
      { controllerOperation: awaitingIdle, statusReport: report('Alarm') },
    ],
    ['a work-Z read', { controllerOperation: { kind: 'work-z-recovery', phase: 'offsets' } }],
    ['the handshake', { controllerOperation: { kind: 'connection-handshake', phase: 'settings' } }],
  ])('raises no notice for %s', (_label, state) => {
    const patch = buildPortClosePatch(idle(state));
    expect(patch.connection).toEqual({ kind: 'disconnected' });
    expect(patch).not.toHaveProperty('safetyNotice');
  });

  // A typed `$$` owns the same read as the rail's Read button: it moves nothing.
  it('raises no notice for a settings read typed in the Console', () => {
    useLaserStore.setState(idle({}));
    const refs = { settingsCollector: idleCollector(), settingsCollectorSessionEpoch: null };
    beginConsoleSettingsRead(useLaserStore.setState, useLaserStore.getState, refs);
    expect(useLaserStore.getState().controllerOperation?.kind).toBe('interactive-command');
    expect(buildPortClosePatch(useLaserStore.getState())).not.toHaveProperty('safetyNotice');
    useLaserStore.setState(initialLaserState());
  });

  // Abort and Reset controller write Ctrl-X; until the controller reports from
  // the other side of it, the reset is not proven delivered and the motion it
  // was stopping may still run.
  it.each<[string, Partial<LaserState>]>([
    [
      'a reset being written',
      { controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 } },
    ],
    ['a reset with no report since', { controllerOperation: awaitingIdle, statusReport: null }],
    [
      'a reset answered by a moving report',
      { controllerOperation: awaitingIdle, statusReport: report('Run') },
    ],
  ])('raises the moving notice for %s', (_label, state) => {
    expect(buildPortClosePatch(idle(state)).safetyNotice).toEqual(disconnectDuringMotionNotice());
  });

  it.each<[string, LaserControllerOperation]>([
    ['Home', { kind: 'home', phase: 'command', idleReports: 0, operationId: 1 }],
    ['auto-focus', { kind: 'autofocus', phase: 'command', idleReports: 0 }],
    [
      'a probe',
      { kind: 'probe', phase: 'sequence', idleReports: 0, transactionId: 1, affectsXy: false },
    ],
    ['a console command', interactiveControllerOperation('G0 X10')],
  ])('raises the moving notice for %s', (_label, operation) => {
    expect(buildPortClosePatch(idle({ controllerOperation: operation })).safetyNotice).toEqual(
      disconnectDuringMotionNotice(),
    );
  });

  it('raises the moving notice for a jog or Frame', () => {
    const motionOperation = startMotionOperation('jog', ['$J=G91 X1 F600\n']);
    expect(buildPortClosePatch(idle({ motionOperation })).safetyNotice).toEqual(
      disconnectDuringMotionNotice(),
    );
  });

  it('keeps the job notice for a job and its post-job settle', () => {
    expect(buildPortClosePatch(idle({ streamer: streamingState() })).safetyNotice).toEqual(
      disconnectDuringJobNotice(),
    );
    const settle: LaserControllerOperation = {
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
      idleReports: 0,
    };
    expect(buildPortClosePatch(idle({ controllerOperation: settle })).safetyNotice).toEqual(
      disconnectDuringJobNotice(),
    );
  });

  it('keeps an earlier notice when nothing was moving', () => {
    const earlier = disconnectDuringJobNotice();
    const patch = buildPortClosePatch(idle({ safetyNotice: earlier }));
    expect(patch).not.toHaveProperty('safetyNotice');
  });

  it('names a Wi-Fi or Ethernet link, which has no USB cable (D7-P3-3)', () => {
    const tcp = { serialPortInfo: { transport: 'tcp' } } as const;
    const job = buildPortClosePatch(idle({ ...tcp, streamer: streamingState() })).safetyNotice;
    expect(job).toEqual(disconnectDuringJobNotice('network'));
    expect(job?.message).toMatch(/^Network connection was lost during the job/);
    expect(job?.message).toContain('reconnect from the network connection form');
    const motion = buildPortClosePatch(
      idle({ ...tcp, motionOperation: startMotionOperation('jog') }),
    );
    expect(motion.safetyNotice?.message).toMatch(/^Network connection was lost while/);
    const fire = buildPortClosePatch(idle({ ...tcp, fireActive: true })).safetyNotice;
    expect(fire?.message).toMatch(/^Network connection was lost while the momentary Fire/);
    for (const notice of [job, motion.safetyNotice, fire]) {
      expect(notice?.message).not.toContain('USB');
    }
  });
});

describe('jogFrameCommandBlockMessage without a status report', () => {
  // Wording only: both answers block, but a disconnected beginner is told to
  // connect rather than to wait for a report that will never come (U1-P2-4).
  it('says to connect when no machine is connected', () => {
    const state: LaserState = { ...useLaserStore.getState(), ...initialLaserState() };
    expect(jogFrameCommandBlockMessage(state)).toBe(CONNECT_MACHINE_FIRST);
  });

  it('keeps the Idle wording for a connected controller that has not reported', () => {
    const state: LaserState = {
      ...useLaserStore.getState(),
      ...initialLaserState(),
      connection: { kind: 'connected' },
    };
    expect(jogFrameCommandBlockMessage(state)).toBe(UNKNOWN_IDLE_STATUS_MESSAGE);
  });
});
