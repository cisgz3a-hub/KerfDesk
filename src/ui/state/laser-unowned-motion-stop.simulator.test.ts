// Controller audit 2 (ADR-375), C-2: Abort for motion a Console command
// started, against the GRBL simulator. Nothing here owns that motion, so Abort
// used to send the soft reset straight into it: GRBL kills the steppers in a
// cycle or a jog and raises ALARM:3, "position has likely been lost".
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L386

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { createStreamer } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialPortRef } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Connect the real store, finish the handshake and wait for the first Idle
 *  report on the one-second idle poll. */
async function connectIdle(options: CreateGrblSimulatorOptions): Promise<GrblSimulator> {
  const sim = createGrblSimulator(options);
  await useLaserStore.getState().connect(sim.adapter);
  await pump(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

/** Send a Console line and wait for the idle poll to report its motion. */
async function consoleMotion(line: string, reported: 'Run' | 'Jog'): Promise<void> {
  const sent = useLaserStore.getState().sendConsoleCommand(line);
  await pump(50);
  await sent;
  await pump(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe(reported);
}

/** Abort, and the bytes written from then on. */
async function abort(sim: GrblSimulator): Promise<ReadonlyArray<string>> {
  const before = sim.outbound().length;
  const stopping = useLaserStore.getState().stopJob();
  await pump(500);
  await stopping;
  return sim.outbound().slice(before);
}

function withoutStatusQueries(written: ReadonlyArray<string>): ReadonlyArray<string> {
  return written.filter((data) => data !== '?');
}

function deferred<T>() {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function holdAbortCompletion(sim: GrblSimulator) {
  const reset = deferred<undefined>();
  const release = deferred<undefined>();
  const originalWrite = sim.port.connection.write;
  let resetHeld = false;
  let releaseCalls = 0;
  vi.spyOn(sim.port.connection, 'write').mockImplementation(async (line) => {
    if (line === '\x18' && !resetHeld) {
      resetHeld = true;
      await reset.promise;
      return;
    }
    await originalWrite(line);
  });
  const hostedStreaming: HostedStreamRefill = {
    isArmed: () => false,
    arm: async () => undefined,
    release: async () => {
      if (++releaseCalls === 1) await release.promise;
    },
    onWriteError: () => () => undefined,
  };
  Object.assign(sim.port.connection, { hostedStreaming });
  return { reset, release, resetStarted: () => resetHeld };
}

describe('Abort for Console motion on GRBL', () => {
  it('holds a Console G1 and resets only once the hold is complete', async () => {
    const sim = await connectIdle({ motionMs: 5_000 });
    await consoleMotion('G1 X300 F100', 'Run');

    const written = await abort(sim);

    // The reset waits for a status report asked for after the hold.
    const hold = written.indexOf('!');
    const reset = written.indexOf('\x18');
    expect(withoutStatusQueries(written)[0]).toBe('!');
    expect(written.slice(hold, reset)).toContain('?');
    expect(reset).toBeGreaterThan(hold);
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(sim.state().machine).toBe('Idle');
  });

  it('cancels a Console jog with jog cancel and no reset', async () => {
    const sim = await connectIdle({ motionMs: 5_000 });
    await consoleMotion('$J=G91 X50 F1000', 'Jog');

    const written = await abort(sim);

    expect(withoutStatusQueries(written)).toEqual(['\x85', 'M5\n', 'M9\n']);
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(sim.state().machine).toBe('Idle');
  });
});

describe('Abort accessory cleanup and controller ownership', () => {
  it('turns off a Console spindle and coolant after cancelling a jog without losing position', async () => {
    const sim = await connectIdle({
      motionMs: 5_000,
      settings: [
        [32, '0'],
        [30, '12000'],
      ],
    });
    for (const line of ['M3 S12000', 'M8']) {
      const sent = useLaserStore.getState().sendConsoleCommand(line);
      await pump(50);
      await sent;
    }
    await consoleMotion('$J=G91 X50 F1000', 'Jog');
    expect(sim.state().spindle).toBe(12_000);
    expect(sim.outbound()).toContain('M8\n');
    const position = sim.state().mpos;
    const session = useLaserStore.getState().controllerSessionEpoch;

    const written = await abort(sim);

    expect(withoutStatusQueries(written)).toEqual(['\x85', 'M5\n', 'M9\n']);
    expect(written.slice(written.indexOf('\x85'), written.indexOf('M5\n'))).toContain('?');
    expect(sim.state().spindle).toBe(0);
    // The simulator models spindle, not coolant: M8/M9 assertions prove the
    // coolant wire contract, not physical pump state.
    expect(sim.state().mpos).toEqual(position);
    expect(sim.state().machine).toBe('Idle');
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(session);
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });

  it('retires a pending hold Abort when another controller replaces its connection', async () => {
    await connectIdle({ motionMs: 5_000 });
    await consoleMotion('G1 X300 F100', 'Run');
    let stopped = false;
    const stopping = useLaserStore
      .getState()
      .stopJob()
      .then(() => {
        stopped = true;
      });
    await pump(5);
    expect(stopped).toBe(false);

    const replacement = createGrblSimulator({ motionMs: 5_000 });
    const switching = useLaserStore.getState().connect(replacement.adapter);
    await pump(10);
    await switching;
    // The replacement controller is already moving when its port opens.
    await replacement.port.connection.write('G1 X300 F100\n');
    const before = replacement.outbound().length;
    expect(replacement.state().machine).toBe('Run');
    await pump(150);
    await stopping;

    expect(withoutStatusQueries(replacement.outbound().slice(before))).toEqual([]);
    expect(replacement.state().machine).toBe('Run');
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });
});

describe('Unconfirmed Console jog Abort', () => {
  it.each(['silent', 'still jogging'] as const)(
    'reports accessories unconfirmed when %s',
    async (response) => {
      const sim = await connectIdle({
        motionMs: 30_000,
        settings: [
          [32, '0'],
          [30, '12000'],
        ],
      });
      const spindle = useLaserStore.getState().sendConsoleCommand('M3 S12000');
      await pump(50);
      await spindle;
      await consoleMotion('$J=G91 X50 F1000', 'Jog');
      useLaserStore.setState({ airAssistOn: true });
      const originalWrite = sim.port.connection.write;
      const write = vi.spyOn(sim.port.connection, 'write').mockImplementation(async (data) => {
        if (response === 'silent' && data === '?') return;
        if (response === 'still jogging' && data === '\x85') return;
        await originalWrite(data);
      });

      const stopping = useLaserStore.getState().stopJob();
      await pump(2_100);
      await stopping;

      const written = write.mock.calls.map(([line]) => line);
      expect(written).toContain('\x85');
      expect(withoutStatusQueries(written)).toEqual(['\x85']);
      expect(sim.state().spindle).toBe(12_000);
      expect(useLaserStore.getState().airAssistOn).toBe(true);
      expect(useLaserStore.getState().safetyNotice?.message).toContain(
        'Accessories may still be on',
      );
      expect(useLaserStore.getState().alarmCode).toBeNull();
      write.mockRestore();
    },
  );
});

describe('Abort completion after reconnect', () => {
  it.each(['replacement', 'reopened'] as const)(
    'preserves the %s connection and its new stream',
    async (kind) => {
      const original = await connectIdle({ motionMs: 5_000 });
      let finishRelease = (): void => undefined;
      const heldRelease = new Promise<void>((resolve) => {
        finishRelease = resolve;
      });
      let holdRelease = true;
      const hostedStreaming: HostedStreamRefill = {
        isArmed: () => false,
        arm: async () => undefined,
        release: async () => {
          if (holdRelease) await heldRelease;
        },
        onWriteError: () => () => undefined,
      };
      Object.assign(original.port.connection, { hostedStreaming });
      const oldAttempt = useLaserStore.getState().connectionAttempt ?? 0;
      let stopped = false;
      const stopping = useLaserStore
        .getState()
        .stopJob()
        .then(() => {
          stopped = true;
        });
      await pump(5);
      expect(original.outbound()).toContain('\x18');
      expect(stopped).toBe(false);

      holdRelease = false;
      const replacement = kind === 'reopened' ? original : createGrblSimulator({ motionMs: 5_000 });
      const switching = useLaserStore.getState().connect(replacement.adapter);
      await pump(1_100);
      await switching;
      await replacement.port.connection.write('G1 X300 F100\n');
      await pump(10);
      const streamer = { ...createStreamer('G1 X400 F100\n'), status: 'streaming' as const };
      const frameVerification = { boundsSignature: '0,0,10,10', wco: null, workOriginActive: true };
      useLaserStore.setState({
        streamer,
        frameVerification,
        workOriginActive: true,
        workOriginSource: 'g92',
        activeJobMachineKind: 'cnc',
      });
      const before = replacement.outbound().length;
      expect(useLaserStore.getState().connectionAttempt).toBeGreaterThan(oldAttempt);

      finishRelease();
      await pump(150);
      await stopping;

      expect(withoutStatusQueries(replacement.outbound().slice(before))).toEqual([]);
      expect(replacement.state().machine).toBe('Run');
      expect(useLaserStore.getState().streamer).toBe(streamer);
      expect(useLaserStore.getState().frameVerification).toBe(frameVerification);
      expect(useLaserStore.getState().workOriginActive).toBe(true);
      expect(useLaserStore.getState().activeJobMachineKind).toBe('cnc');
      expect(useLaserStore.getState().alarmCode).toBeNull();
    },
  );
});

describe('Late rejected Abort ownership', () => {
  it('retires an old rejection while the replacement connection waits for its picker', async () => {
    const original = await connectIdle({ motionMs: 5_000 });
    const pending = holdAbortCompletion(original);
    const stopping = useLaserStore
      .getState()
      .stopJob()
      .then(
        () => null,
        (error: unknown) => error,
      );
    await pump(5);
    expect(pending.resetStarted()).toBe(true);
    const replacement = createGrblSimulator({ motionMs: 5_000 });
    const replacementPort = await replacement.adapter.serial.requestPort();
    const picker = deferred<SerialPortRef | null>();
    const adapter = {
      ...replacement.adapter,
      serial: { ...replacement.adapter.serial, requestPort: () => picker.promise },
    };
    const switching = useLaserStore.getState().connect(adapter, { portSelection: 'choose' });
    await pump(1_100);
    expect(useLaserStore.getState().connection.kind).toBe('connecting');
    expect(useLaserStore.getState().safetyNotice).toBeNull();

    pending.reset.reject(new Error('old reset transport failed'));
    pending.release.resolve(undefined);
    await pump(10);
    expect(await stopping).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    picker.resolve(replacementPort);
    await pump(1_100);
    await switching;

    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(replacement.outbound()).not.toContain('\x18');
    expect(replacement.outbound()).not.toContain('M5\n');
    expect(replacement.outbound()).not.toContain('M9\n');
  });

  it.each(['connected', 'closed'] as const)(
    'still reports same-attempt reset failure when %s',
    async (port) => {
      const sim = await connectIdle({ motionMs: 5_000 });
      const attempt = useLaserStore.getState().connectionAttempt;
      const pending = holdAbortCompletion(sim);
      const stopping = useLaserStore
        .getState()
        .stopJob()
        .then(
          () => null,
          (error: unknown) => error,
        );
      await pump(5);
      expect(pending.resetStarted()).toBe(true);
      if (port === 'closed') sim.yankCable();
      pending.reset.reject(new Error('current reset transport failed'));
      pending.release.resolve(undefined);
      await pump(10);

      expect(await stopping).toEqual(new Error('current reset transport failed'));
      expect(useLaserStore.getState().connectionAttempt).toBe(attempt);
      expect(useLaserStore.getState().safetyNotice).toMatchObject({
        kind: 'write-failed',
        action: 'stop',
      });
    },
  );
});
