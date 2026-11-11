// A painted second pass re-burns part of a part that is already finished. It
// is not a new part, so it consumes no serial number or CSV record and does
// not arm the "after completed job" advance at all; armed, it reached the
// stale-values check with the archived run's project and warned that variable
// data "was changed while it ran" (oracle audit O1, O5-P3-5).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { UNLOADED_RECOVERY_SNAPSHOT } from '../state/recovery/recovery-model';
import { useStore } from '../state/store';
import type * as ExecutionTrackingModule from './start-job-execution-tracking';
import { transmitPreparedStart } from './start-job-transmission';
import { cancelVariableStreamAdvancement } from './variable-stream-advancement';

const mocks = vi.hoisted(() => ({ activate: vi.fn(async () => undefined) }));
vi.mock('./start-job-execution-tracking', async (load) => ({
  ...(await load<typeof ExecutionTrackingModule>()),
  activateAcceptedFreshRun: mocks.activate,
}));

const initialLaser = useLaserStore.getState();
const initialApp = useStore.getState();

afterEach(() => {
  cancelVariableStreamAdvancement();
  useLaserStore.setState(initialLaser, true);
  useStore.setState(initialApp, true);
});

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function transmit(prepared: Record<string, unknown>, project: ReturnType<typeof createProject>) {
  const started = step(createStreamer('G1 X1')).state;
  const startJob = vi.fn(async () => {
    useLaserStore.setState((state) => ({
      streamer: started,
      activeRunId: 'second-pass-run' as NonNullable<typeof state.activeRunId>,
      streamerEpoch: state.streamerEpoch + 1,
    }));
  });
  const pending = transmitPreparedStart({
    args: {
      project,
      prepared: { gcode: 'G1 X1', prepared: {}, canvasPlan: {}, ...prepared },
      machineKind: 'laser',
      laser: {},
      completedReceipt: null,
      repository: { getSnapshot: () => UNLOADED_RECOVERY_SNAPSHOT },
      reviewedAtIso: new Date().toISOString(),
      reviewModel: {},
    },
    runId: 'second-pass-run',
    handoffArmed: false,
    authorizationArgs: {},
    authorization: { ok: true, laser: { startJob } },
  } as unknown as Parameters<typeof transmitPreparedStart>[0]);
  return { pending, started };
}

function finishCleanly(started: ReturnType<typeof step>['state']): void {
  useLaserStore.setState({
    streamer: { ...started, status: 'done' },
    controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 0 },
  });
  useLaserStore.setState({
    streamer: null,
    controllerOperation: null,
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
  });
}

describe('variable advancement for a painted second pass', () => {
  const base = createProject();
  const project = {
    ...base,
    variables: { ...base.variables!, advancement: 'after-successful-stream' as const },
  };

  it('does not arm the advance for a second pass over a finished part', async () => {
    const advance = vi.fn();
    useStore.setState({ project, advanceVariablesAfter: advance });
    const { pending, started } = transmit(
      { laserSecondPassChain: [{ sourceRunId: 'finished-run' }] },
      project,
    );
    await flush();
    finishCleanly(started);
    await pending;

    expect(advance).not.toHaveBeenCalled();
  });

  it('still advances after an ordinary completed Start', async () => {
    const advance = vi.fn();
    useStore.setState({ project, advanceVariablesAfter: advance });
    const { pending, started } = transmit({}, project);
    await flush();
    finishCleanly(started);
    await pending;

    expect(advance).toHaveBeenCalledExactlyOnceWith(project, 'successful-stream');
  });
});
