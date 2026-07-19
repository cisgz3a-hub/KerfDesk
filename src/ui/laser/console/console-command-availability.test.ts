import { describe, expect, it } from 'vitest';
import { grblDriver, marlinDriver, smoothiewareDriver } from '../../../core/controllers';
import type { LaserState } from '../../state/laser-store';
import {
  consoleCommandDisabledReason,
  consoleQuickCommandDisabledReason,
  type ConsoleCommandAvailabilityState,
} from './console-command-availability';

describe('console command availability', () => {
  it('reports connection and driver validation failures before allowing a send', () => {
    expect(consoleCommandDisabledReason(grblDriver, '$$', state({ connected: false }))).toContain(
      'Connect',
    );
    expect(consoleCommandDisabledReason(grblDriver, 'G0 X0\nG0 Y0', state())).toContain('one line');
  });

  it('blocks ordinary commands during momentary fire but leaves realtime status available', () => {
    const firing = state({ fireActive: true });

    expect(consoleCommandDisabledReason(grblDriver, 'G0 X0', firing)).toContain(
      'Release the momentary Fire',
    );
    expect(consoleQuickCommandDisabledReason(grblDriver, '?', firing)).toBeNull();
  });

  it('uses driver metadata instead of hardcoded command names for recovery commands', () => {
    const activeJob = state({ streamer: streamingJob() });

    expect(consoleQuickCommandDisabledReason(grblDriver, '$I', activeJob)).toContain(
      'A job is active',
    );
    expect(consoleQuickCommandDisabledReason(smoothiewareDriver, 'M999', activeJob)).toBeNull();
    expect(consoleQuickCommandDisabledReason(marlinDriver, 'M112', activeJob)).toBeNull();
  });

  it('requires a known Idle report only for commands whose driver marks them Idle-only', () => {
    expect(
      consoleCommandDisabledReason(grblDriver, '$32=1', state({ machineState: null })),
    ).toContain('status is not known');
    expect(
      consoleCommandDisabledReason(grblDriver, '$32=1', state({ machineState: 'Run' })),
    ).toContain('currently Run');
    expect(
      consoleCommandDisabledReason(grblDriver, '$32=1', state({ machineState: 'Idle' })),
    ).toBeNull();
    expect(
      consoleCommandDisabledReason(grblDriver, '$$', state({ machineState: null })),
    ).toBeNull();
  });

  it('surfaces every active-operation owner used by the console gate', () => {
    expect(
      consoleCommandDisabledReason(grblDriver, '$$', state({ motionOperation: {} })),
    ).toContain('jog or frame');
    expect(
      consoleCommandDisabledReason(
        grblDriver,
        '$$',
        state({ controllerOperation: { kind: 'interactive-command' } }),
      ),
    ).toContain('controller operation');
    expect(
      consoleCommandDisabledReason(grblDriver, '$$', state({ autofocusBusy: true })),
    ).toContain('Auto-focus');
  });
});

type StateOverrides = {
  readonly connected?: boolean;
  readonly fireActive?: boolean;
  readonly streamer?: LaserState['streamer'];
  readonly motionOperation?: object | null;
  readonly controllerOperation?: { readonly kind: 'interactive-command' } | null;
  readonly autofocusBusy?: boolean;
  readonly machineState?: string | null;
};

function state(overrides: StateOverrides = {}): ConsoleCommandAvailabilityState {
  const machineState = overrides.machineState === undefined ? 'Idle' : overrides.machineState;
  return {
    connection: { kind: overrides.connected === false ? 'disconnected' : 'connected' },
    statusReport:
      machineState === null
        ? null
        : ({ state: machineState } as ConsoleCommandAvailabilityState['statusReport']),
    fireActive: overrides.fireActive ?? false,
    streamer: overrides.streamer ?? null,
    motionOperation: (overrides.motionOperation ??
      null) as ConsoleCommandAvailabilityState['motionOperation'],
    controllerOperation:
      overrides.controllerOperation === null || overrides.controllerOperation === undefined
        ? null
        : {
            kind: 'interactive-command',
            phase: 'command',
            label: 'test operation',
          },
    autofocusBusy: overrides.autofocusBusy ?? false,
  };
}

function streamingJob(): NonNullable<LaserState['streamer']> {
  return {
    status: 'streaming',
    streamingMode: 'char-counted',
    queued: [],
    queueIndex: 0,
    inFlight: [],
    inFlightBytes: 0,
    completed: 0,
    total: 0,
    rxBufferBytes: 120,
    toolChangePause: false,
  };
}
