import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancel, createStreamer, markErrored, step } from '../../core/controllers/grbl';
import {
  armVariableStreamAdvancement,
  cancelVariableStreamAdvancement,
  variableStreamOutcome,
} from './variable-stream-advancement';
import { createProject } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { createRunId } from '../state/recovery';

describe('variable advancement ownership', () => {
  const initialLaser = useLaserStore.getState();
  const initialApp = useStore.getState();
  const runId = createRunId();
  const base = createProject();
  const project = {
    ...base,
    variables: { ...base.variables!, advancement: 'after-successful-stream' as const },
  };
  const advance = vi.fn();
  const started = step(createStreamer('G1 X1')).state;
  beforeEach(() => {
    advance.mockClear();
    useStore.setState({ project, advanceVariablesAfter: advance });
  });
  afterEach(() => {
    cancelVariableStreamAdvancement();
    useLaserStore.setState(initialLaser, true);
    useStore.setState(initialApp, true);
  });
  const start = (): void =>
    useLaserStore.setState((state) => ({
      activeRunId: runId,
      streamerEpoch: state.streamerEpoch + 1,
      streamer: started,
    }));
  // A clean finish: the post-job settle waits for Idle, and an Idle report
  // from the connected controller releases the stream.
  const finish = (): void => {
    useLaserStore.setState({
      streamer: { ...started, status: 'done' },
      controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 0 },
    });
    releaseAtIdle();
  };
  const releaseAtIdle = (): void =>
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

  it('remembers a settled stream until the initial transport write is accepted', () => {
    const observer = armVariableStreamAdvancement(project, runId);
    start();
    finish();
    expect(advance).not.toHaveBeenCalled();
    observer.accept();
    observer.accept();
    expect(advance).toHaveBeenCalledExactlyOnceWith(project, 'successful-stream');
  });

  // Controller audit gap-start-6: the settle failed, so the stream stayed
  // 'done' until a later Idle report released it; the recovery ledger records
  // that run as interrupted, and the variables must not advance either.
  it('does not advance when the stream was released without a clean settle', () => {
    const observer = armVariableStreamAdvancement(project, runId);
    start();
    observer.accept();
    useLaserStore.setState({ streamer: { ...started, status: 'done' }, controllerOperation: null });
    releaseAtIdle();
    expect(advance).not.toHaveBeenCalled();
  });

  it('starts after a prior completed run whose recovery ID remains in the store', () => {
    useLaserStore.setState({ activeRunId: createRunId(), streamer: null });
    const observer = armVariableStreamAdvancement(project, runId);
    useLaserStore.setState({ lastWriteError: null });
    start();
    observer.accept();
    finish();
    expect(advance).toHaveBeenCalledExactlyOnceWith(project, 'successful-stream');
  });

  it('retains the exact prepared output scope through later selection changes', () => {
    const outputScope = {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['slot-3'],
    };
    const observer = armVariableStreamAdvancement(project, runId, outputScope);
    start();
    useStore.setState({ selectedObjectId: 'later-slot', additionalSelectedIds: new Set() });
    observer.accept();
    finish();
    expect(advance).toHaveBeenCalledExactlyOnceWith(project, 'successful-stream', outputScope);
  });

  it.each(['failed write', 'session replacement', 'stream replacement'] as const)(
    'does not advance after %s',
    (reason) => {
      const observer = armVariableStreamAdvancement(project, runId);
      start();
      if (reason === 'failed write') observer.cancel();
      if (reason === 'session replacement')
        useLaserStore.setState((state) => ({
          controllerSessionEpoch: state.controllerSessionEpoch + 1,
        }));
      if (reason === 'stream replacement')
        useLaserStore.setState((state) => ({
          activeRunId: createRunId(),
          streamerEpoch: state.streamerEpoch + 1,
        }));
      finish();
      observer.accept();
      expect(advance).not.toHaveBeenCalled();
    },
  );
});

describe('variable stream advancement outcome', () => {
  it('accepts only a completed stream released after controller settle', () => {
    const started = step(createStreamer('G1 X1')).state;
    const done = { ...started, status: 'done' as const };
    expect(variableStreamOutcome(started, done, false)).toBe('pending');
    expect(variableStreamOutcome(done, null, true)).toBe('successful');
  });

  // Controller audit gap-start-6: a 'done' stream released at Idle after its
  // settle failed is not a successful stream; the recovery ledger records it
  // as interrupted too.
  it('rejects a completed stream released without a clean settle', () => {
    const done = { ...step(createStreamer('G1 X1')).state, status: 'done' as const };
    expect(variableStreamOutcome(done, null, false)).toBe('failed');
  });

  it('rejects cancellation, error, and disconnect transitions', () => {
    const started = step(createStreamer('G1 X1')).state;
    expect(variableStreamOutcome(started, cancel(started), false)).toBe('pending');
    expect(variableStreamOutcome(cancel(started), null, true)).toBe('failed');
    expect(variableStreamOutcome(started, markErrored(started), false)).toBe('failed');
    expect(variableStreamOutcome(started, null, true)).toBe('failed');
  });
});
