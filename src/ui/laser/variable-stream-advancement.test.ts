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
  const finish = (): void => {
    useLaserStore.setState({ streamer: { ...started, status: 'done' } });
    useLaserStore.setState({ streamer: null });
  };

  it('remembers a settled stream until the initial transport write is accepted', () => {
    const observer = armVariableStreamAdvancement(project, runId);
    start();
    finish();
    expect(advance).not.toHaveBeenCalled();
    observer.accept();
    observer.accept();
    expect(advance).toHaveBeenCalledExactlyOnceWith(project, 'successful-stream');
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
    expect(variableStreamOutcome(started, done)).toBe('pending');
    expect(variableStreamOutcome(done, null)).toBe('successful');
  });

  it('rejects cancellation, error, and disconnect transitions', () => {
    const started = step(createStreamer('G1 X1')).state;
    expect(variableStreamOutcome(started, cancel(started))).toBe('pending');
    expect(variableStreamOutcome(cancel(started), null)).toBe('failed');
    expect(variableStreamOutcome(started, markErrored(started))).toBe('failed');
    expect(variableStreamOutcome(started, null)).toBe('failed');
  });
});
