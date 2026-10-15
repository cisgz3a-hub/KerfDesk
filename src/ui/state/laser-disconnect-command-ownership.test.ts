import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marlinDriver, smoothiewareDriver, type ControllerDriver } from '../../core/controllers';
import { createStreamer, pause, step } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import {
  runIntentionalDisconnectOnce,
  type ConnectionTeardownOwnershipRefs,
} from './laser-connection-teardown';
import { cancelScheduledControllerQualification } from './laser-controller-qualification';
import {
  cancelControllerLifecycleRefs,
  consumeControllerCommandResponse,
} from './laser-interactive-command';
import { runConfirmedPauseJob, runConfirmedResumeJob } from './laser-job-pause-resume';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { controllerOperationOwnsPolling } from './laser-status-polling-policy';
import { deferredTestWrite } from './laser-test-command-control';

function connection(hostedStreaming?: HostedStreamRefill): SerialConnection {
  return {
    write: async () => undefined,
    close: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    ...(hostedStreaming === undefined ? {} : { hostedStreaming }),
  };
}

function harness(driver: ControllerDriver = marlinDriver, port = connection()) {
  const base = makeLineHandlerHarness();
  const ownership: ConnectionTeardownOwnershipRefs = {
    closeRequests: new WeakMap(),
    intentionalDisconnects: new WeakMap(),
  };
  const refs = { ...base.refs, ...ownership, driver, connection: port, writeEpoch: 0 };
  // The fan has already been commanded on. Pause queues M107; a normal
  // Marlin Resume restores M106 before the next move.
  const stream = step(
    createStreamer('M106 S100\nG1 X1\nG1 X2', { streamingMode: 'ping-pong' }),
  ).state;
  base.set({
    activeControllerKind: driver.kind,
    capabilities: driver.capabilities,
    streamer: pause(stream),
    controllerOperation: null,
  });
  const context = {
    ...base,
    refs,
    driver: () => driver,
    safeWrite: vi.fn(async (): Promise<void> => undefined),
    failDarkStop: vi.fn(async () => undefined),
  };
  openedRefs.push(refs);
  return context;
}

const openedRefs: Array<ReturnType<typeof makeLineHandlerHarness>['refs']> = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const refs of openedRefs.splice(0)) {
    cancelControllerLifecycleRefs(refs, 'Test cleanup.');
    cancelScheduledControllerQualification(refs);
  }
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function claimDisconnect(context: ReturnType<typeof harness>) {
  const closing = deferredTestWrite();
  const operation = runIntentionalDisconnectOnce(
    context.refs,
    context.refs.connection,
    false,
    () => closing.promise,
  );
  return { finish: closing.resolve, operation };
}

describe('Disconnect owns Pause and Resume admission', () => {
  it.each([
    ['Pause', runConfirmedPauseJob],
    ['Resume', runConfirmedResumeJob],
  ] as const)(
    'refuses %s as soon as Disconnect is claimed, before public state changes',
    async (_label, run) => {
      const context = harness();
      const closing = claimDisconnect(context);
      const outcome = run(context).catch((error: unknown) => error);
      await flush();
      cancelControllerLifecycleRefs(context.refs, 'Test cleanup.');
      const error = await outcome;
      closing.finish();
      await closing.operation;

      expect(context.safeWrite).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/disconnecting/i);
      expect(context.failDarkStop).not.toHaveBeenCalled();
    },
  );

  it('does not request a second fail-dark stop when Disconnect claims a pending Resume', async () => {
    const context = harness();
    const restoring = deferredTestWrite();
    context.safeWrite.mockImplementation(() => restoring.promise);
    const outcome = runConfirmedResumeJob(context).catch((error: unknown) => error);
    await flush();
    expect(context.safeWrite).toHaveBeenCalledWith('M106 S100\n', 'resume', 'system');

    const closing = claimDisconnect(context);
    consumeControllerCommandResponse(context.refs, { kind: 'ok' }, 'ok');
    restoring.resolve();
    const error = await outcome;
    closing.finish();
    await closing.operation;

    expect((error as Error).message).toMatch(/disconnecting/i);
    expect(context.safeWrite).toHaveBeenCalledTimes(1);
    expect(context.failDarkStop).not.toHaveBeenCalled();
    expect(context.get().safetyNotice).toBeNull();
  });

  it.each(['disconnect', 'replacement', 'reset'] as const)(
    'retires a Pause waiting for hosted refill when a %s wins ownership',
    async (change) => {
      const release = deferredTestWrite();
      const context = harness(
        marlinDriver,
        connection({
          isArmed: () => true,
          arm: async () => undefined,
          release: () => release.promise,
          onWriteError: () => () => undefined,
        }),
      );
      const outcome = runConfirmedPauseJob(context).catch((error: unknown) => error);
      await flush();
      expect(context.safeWrite).not.toHaveBeenCalled();

      const closing = change === 'reset' ? null : claimDisconnect(context);
      if (change === 'replacement') context.refs.connection = connection();
      if (change === 'reset') {
        handleLine(context.set, context.get, context.refs, context.safeWrite, 'start');
      }
      release.resolve();
      const error = await outcome;
      closing?.finish();
      await closing?.operation;

      expect(context.safeWrite).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(Error);
      expect(context.failDarkStop).not.toHaveBeenCalled();
    },
  );
});

describe('Disconnect retains public ownership through controller boundaries', () => {
  it.each([
    ['Marlin reboot', marlinDriver, 'start'],
    ['Smoothie reboot', smoothiewareDriver, 'Smoothie version 1.0'],
    ['text Alarm', smoothiewareDriver, 'ALARM: Hard limit +X'],
    ['Alarm status', smoothiewareDriver, '<Alarm|MPos:0,0,0|FS:0,0>'],
    ['Sleep status', smoothiewareDriver, '<Sleep|MPos:0,0,0|FS:0,0>'],
  ] as const)('keeps teardown exclusive after %s', (_label, driver, line) => {
    const context = harness(driver);
    const operation = { kind: 'disconnect', phase: 'stopping' } as const;
    context.set({ controllerOperation: operation });

    handleLine(context.set, context.get, context.refs, context.safeWrite, line);

    expect(context.get().controllerOperation).toBe(operation);
    expect(controllerOperationOwnsPolling(context.get())).toBe(true);
    // The fault still invalidates the old job/evidence; preserving the close
    // owner must not reinterpret it as a successfully paused or stopped job.
    expect(context.get().streamer?.status).not.toBe('paused');
    expect(context.refs.writeEpoch).toBe(1);
  });
});
