// Controller audit 2 (ADR-375), C-2: the stop Abort picks for motion the
// controller reports with no owner here, per reported state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, smoothiewareDriver, type ControllerDriver } from '../../core/controllers';
import type { GrblState, StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { unownedControllerMotion } from './unowned-controller-motion';
import { stopUnownedControllerMotion, UNOWNED_HOLD_SETTLE_TIMEOUT_MS } from './unowned-motion-stop';

function report(state: GrblState, subState: number | null = null): StatusReport {
  const position = { x: 0, y: 0, z: 0 };
  return { state, subState, mPos: position, wPos: null, feed: 0, spindle: 0, wco: null };
}

type Harness = {
  readonly context: Parameters<typeof stopUnownedControllerMotion>[0];
  readonly writes: string[];
  readonly cancelJog: ReturnType<typeof vi.fn>;
  readonly patch: (partial: Partial<LaserState>) => void;
};

/** A connected store with no owner, and a controller that answers each status
 *  query with the next report in `answers` (the last one repeats). A report in
 *  `whileHolding` lands while the feed hold is being written. */
function harness(
  statusReport: StatusReport,
  answers: ReadonlyArray<StatusReport> = [],
  driver: ControllerDriver = grblDriver,
  whileHolding: StatusReport | null = null,
): Harness {
  const cancelJog = vi.fn(async () => undefined);
  let state = {
    connection: { kind: 'connected' },
    streamer: null,
    controllerOperation: null,
    motionOperation: null,
    fireActive: false,
    mpgActive: null,
    statusReport,
    statusSequence: 1,
    controllerSessionEpoch: 1,
    cancelJog,
  } as unknown as LaserState;
  const patch = (partial: Partial<LaserState>): void => {
    state = { ...state, ...partial };
  };
  const pending = [...answers];
  const writes: string[] = [];
  const land = (next: StatusReport | undefined): void => {
    if (next !== undefined) patch({ statusReport: next, statusSequence: state.statusSequence + 1 });
  };
  const safeWrite = vi.fn(async (line: string) => {
    writes.push(line);
    if (line === '!') land(whileHolding ?? undefined);
    if (line === '?') land(pending.length > 1 ? pending.shift() : pending[0]);
  });
  return {
    context: { get: () => state, safeWrite, driver: () => driver },
    writes,
    cancelJog,
    patch,
  };
}

const falconLikeDriver: ControllerDriver = {
  ...grblDriver,
  realtime: { ...grblDriver.realtime, jogCancel: null },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stopUnownedControllerMotion', () => {
  it('cancels a jog through the operator Cancel path, with no reset', async () => {
    const { context, writes, cancelJog } = harness(report('Jog'), [report('Idle')]);

    const stopping = stopUnownedControllerMotion(context);
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopping).resolves.toBe('stopped');

    expect(cancelJog).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(['?', 'M5\n', 'M9\n']);
  });

  it('sends a feed hold for a jog on a driver without jog cancel', async () => {
    const { context, writes, cancelJog } = harness(
      report('Jog'),
      [report('Idle')],
      falconLikeDriver,
    );

    const stopping = stopUnownedControllerMotion(context);
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopping).resolves.toBe('stopped');

    expect(writes).toEqual(['!', '?', 'M5\n', 'M9\n']);
    expect(cancelJog).not.toHaveBeenCalled();
  });

  it('falls back to the reset when the jog cancel write fails', async () => {
    const { context, cancelJog } = harness(report('Jog'));
    cancelJog.mockRejectedValueOnce(new Error('port closed'));

    await expect(stopUnownedControllerMotion(context)).resolves.toBe('reset');
  });

  it('holds a run and asks for the reset only after a fresh completed hold', async () => {
    const answers = [report('Hold', 1), report('Hold', 1), report('Hold', 0)];
    const { context, writes } = harness(report('Run'), answers);
    let outcome: string | null = null;
    void stopUnownedControllerMotion(context).then((result) => {
      outcome = result;
    });

    await vi.advanceTimersByTimeAsync(60);
    expect(outcome).toBeNull();
    expect(writes).toEqual(['!', '?', '?']);

    await vi.advanceTimersByTimeAsync(100);
    expect(outcome).toBe('reset');
    expect(writes).toEqual(['!', '?', '?', '?']);
  });

  it('asks again when a report lands while the feed hold is written', async () => {
    // That report may have left the controller before the hold did: an Idle
    // between two Console moves is no proof the second one is not running.
    const { context, writes } = harness(
      report('Run'),
      [report('Hold', 0)],
      grblDriver,
      report('Idle'),
    );

    const stopping = stopUnownedControllerMotion(context);
    await vi.advanceTimersByTimeAsync(100);

    await expect(stopping).resolves.toBe('reset');
    expect(writes).toEqual(['!', '?']);
  });

  it('resets after the bound when the hold never settles', async () => {
    const { context } = harness(report('Run'), [report('Hold', 1)]);
    let outcome: string | null = null;
    void stopUnownedControllerMotion(context).then((result) => {
      outcome = result;
    });

    await vi.advanceTimersByTimeAsync(UNOWNED_HOLD_SETTLE_TIMEOUT_MS - 100);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(outcome).toBe('reset');
  });

  it('stops waiting when the port closes', async () => {
    const { context, patch } = harness(report('Run'), [report('Hold', 1)]);
    let outcome: string | null = null;
    void stopUnownedControllerMotion(context).then((result) => {
      outcome = result;
    });

    await vi.advanceTimersByTimeAsync(60);
    patch({ connection: { kind: 'disconnected' } });
    await vi.advanceTimersByTimeAsync(60);
    expect(outcome).toBe('superseded');
  });

  it('keeps the immediate reset on a driver without a feed hold', async () => {
    const { context, writes } = harness(report('Run'), [], smoothiewareDriver);

    await expect(stopUnownedControllerMotion(context)).resolves.toBe('reset');

    expect(writes).toEqual([]);
  });

  it.each([
    ['a completed hold', report('Hold', 0)],
    ['a closed door hold', report('Door', 0)],
    ['an open door hold', report('Door', 1)],
    ['a hold with no substate', report('Hold')],
    ['homing', report('Home')],
  ])('asks for the reset at once for %s', async (_name, current) => {
    const { context, writes } = harness(current);

    await expect(stopUnownedControllerMotion(context)).resolves.toBe('reset');

    expect(writes).toEqual([]);
  });

  it('waits for a decelerating hold to complete before the reset', async () => {
    const { context, writes } = harness(report('Hold', 1), [report('Hold', 0)]);

    const stopping = stopUnownedControllerMotion(context);
    await vi.advanceTimersByTimeAsync(100);

    await expect(stopping).resolves.toBe('reset');
    expect(writes).toEqual(['?']);
  });

  it('leaves owned motion to the ordinary stop', async () => {
    const { context, writes, cancelJog, patch } = harness(report('Jog'));
    patch({ motionOperation: { kind: 'jog' } as LaserState['motionOperation'] });

    await expect(stopUnownedControllerMotion(context)).resolves.toBe('reset');

    expect(writes).toEqual([]);
    expect(cancelJog).not.toHaveBeenCalled();
  });
});

describe('unownedControllerMotion', () => {
  const base = harness(report('Run')).context.get();

  it.each(['Run', 'Jog', 'Home', 'Hold', 'Door'] as const)('reports %s', (state) => {
    expect(unownedControllerMotion({ ...base, statusReport: report(state) })).toBe(state);
  });

  it.each([
    ['Idle', { statusReport: report('Idle') }],
    ['an unknown state', { statusReport: null }],
    ['a closed port', { connection: { kind: 'disconnected' } }],
    ['a controller operation', { controllerOperation: { kind: 'probe' } }],
    ['a motion operation', { motionOperation: { kind: 'frame' } }],
    ['momentary Fire', { fireActive: true }],
    ['a pendant in MPG mode', { mpgActive: true }],
  ])('reports nothing for %s', (_name, partial) => {
    expect(unownedControllerMotion({ ...base, ...(partial as Partial<LaserState>) })).toBeNull();
  });
});

describe('unowned Abort settlement ownership', () => {
  it('does not send accessory-off until a newer Idle report', async () => {
    const { context, writes } = harness(report('Jog'), [
      report('Jog'),
      report('Jog'),
      report('Idle'),
    ]);
    const stopping = stopUnownedControllerMotion(context);
    await vi.advanceTimersByTimeAsync(60);
    expect(writes).toEqual(['?', '?']);
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopping).resolves.toBe('stopped');
    expect(writes).toEqual(['?', '?', '?', 'M5\n', 'M9\n']);
  });

  it('does not poll a session which replaced the one awaiting its hold write', async () => {
    const { context, writes, patch } = harness(report('Run'), [report('Hold', 0)]);
    const safeWrite = async (line: string): Promise<void> => {
      await context.safeWrite(line);
      if (line === '!') patch({ controllerSessionEpoch: 2 });
    };
    await expect(stopUnownedControllerMotion({ ...context, safeWrite })).resolves.toBe(
      'superseded',
    );
    expect(writes).toEqual(['!']);
  });

  it('does not reset or clean up a session replacing a cancelled jog', async () => {
    const { context, writes, patch, cancelJog } = harness(report('Jog'), [report('Idle')]);
    cancelJog.mockImplementationOnce(async () => {
      patch({ controllerSessionEpoch: 2 });
    });
    await expect(stopUnownedControllerMotion(context)).resolves.toBe('superseded');
    expect(writes).toEqual([]);
  });

  it('retires remaining jog cleanup if its session changes during M5', async () => {
    const { context, writes, patch } = harness(report('Jog'), [report('Idle')]);
    const safeWrite = async (line: string): Promise<void> => {
      await context.safeWrite(line);
      if (line === 'M5\n') patch({ controllerSessionEpoch: 2 });
    };
    const stopping = stopUnownedControllerMotion({ ...context, safeWrite });
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopping).resolves.toBe('superseded');
    expect(writes).toEqual(['?', 'M5\n']);
  });
});
