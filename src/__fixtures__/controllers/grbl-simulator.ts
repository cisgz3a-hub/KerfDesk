// grbl-simulator — wires the pure GRBL firmware reducer onto a fake serial
// port with real (fake-timer-friendly) scheduling. Responses are emitted via
// setTimeout so host write-bookkeeping always completes before the firmware
// answers, exactly like real serial latency. Run tests under vi.useFakeTimers
// and drive with vi.advanceTimersByTimeAsync.
//
// Planner back-pressure is OPT-IN (ADR-265). Pass `plannerBlocks` and the
// simulator withholds `ok` while its planner is full, exactly as real GRBL
// does — the failure mode a character-counting sender exists to prevent. Left
// unset, the simulator acks immediately as it always has, so the existing
// byte-level transcript characterizations stay unchanged. See
// `grbl-sim-backpressure.ts` for the firmware citations.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import { createBackpressureFeeder, type BackpressureFeeder } from './grbl-sim-backpressure';
import {
  DEFAULT_GRBL_SIM_OPTIONS,
  initialGrblSimState,
  reduceGrblSim,
  type GrblSimEffect,
  type GrblSimEvent,
  type GrblSimOptions,
  type GrblSimState,
} from './grbl-sim-machine';
import { createPlanner, type GrblSimPlanner } from './grbl-sim-planner';
import { createRxWindow, GRBL_RX_USABLE_BYTES, type GrblSimRxWindow } from './grbl-sim-rx-window';
import { defaultGrblSimSettings } from './grbl-sim-settings';
import type { PlatformAdapter } from '../../platform/types';

const REALTIME_BYTES = new Set(['?', '!', '~', '\x18', '\x84', '\x85']);
const SOFT_RESET_BYTE = '\x18';

export type CreateGrblSimulatorOptions = Partial<GrblSimOptions> & {
  /** Override or extend the default $$ settings table. */
  readonly settings?: ReadonlyArray<readonly [number, string]>;
  /** Emit the welcome banner when the port opens (default true). */
  readonly emitBannerOnOpen?: boolean;
  /**
   * Model GRBL's bounded planner with this many motion blocks (stock grbl 1.1
   * is 16). Unset means acks stay immediate — the historical behaviour.
   */
  readonly plannerBlocks?: number;
  /** Simulated time one planner block takes to retire. Defaults to `motionMs`. */
  readonly blockRetireMs?: number;
  /** Usable RX ring bytes. Defaults to grbl's 127 (128 less the reserved slot). */
  readonly rxBufferBytes?: number;
};

export type GrblSimulator = {
  readonly adapter: PlatformAdapter;
  readonly port: FakeSerialPort;
  readonly state: () => GrblSimState;
  /** Raw host→firmware payloads, in write order. */
  readonly outbound: () => ReadonlyArray<string>;
  /** Push an asynchronous ALARM:N (e.g. hard limit) into the host. */
  readonly triggerAlarm: (code: number) => void;
  /** Simulate the USB cable being pulled. */
  readonly yankCable: () => void;
  /** RX ring occupancy, peak, and dropped bytes. Inert unless `plannerBlocks` is set. */
  readonly rxWindow: () => GrblSimRxWindow;
  /** Planner occupancy and any withheld ack. Inert unless `plannerBlocks` is set. */
  readonly planner: () => GrblSimPlanner;
};

type HostByteFeeder = Pick<BackpressureFeeder, 'acceptBytes' | 'reset'>;

/** The pre-existing zero-latency path: every complete line is consumed at once. */
function createImmediateFeeder(dispatch: (event: GrblSimEvent) => void): HostByteFeeder {
  let rxBuffer = '';
  return {
    acceptBytes: (data) => {
      for (const ch of data) {
        if (ch === '\n') {
          const line = rxBuffer.trim();
          rxBuffer = '';
          dispatch({ kind: 'rx-line', line });
          continue;
        }
        if (ch !== '\r') rxBuffer += ch;
      }
    },
    reset: () => {
      rxBuffer = '';
    },
  };
}

/**
 * Split a host write into ring bytes and realtime bytes. Realtime bytes are
 * executed immediately and never stored, matching grbl's `ISR(SERIAL_RX)` — so
 * `?`, `!`, `~` and soft reset keep working even while the main loop is blocked
 * on a full planner. That is what keeps a stalled stream abortable.
 */
function routeHostBytes(
  data: string,
  feeder: HostByteFeeder,
  dispatch: (event: GrblSimEvent) => void,
): void {
  let buffered = '';
  for (const ch of data) {
    if (!REALTIME_BYTES.has(ch)) {
      buffered += ch;
      continue;
    }
    feeder.acceptBytes(buffered);
    buffered = '';
    dispatch({ kind: 'rx-realtime', byte: ch });
    // A soft reset flushes the receive buffer and the planner on real hardware.
    if (ch === SOFT_RESET_BYTE) feeder.reset();
  }
  feeder.acceptBytes(buffered);
}

export function createGrblSimulator(options: CreateGrblSimulatorOptions = {}): GrblSimulator {
  const {
    settings: settingOverrides,
    emitBannerOnOpen,
    plannerBlocks,
    blockRetireMs,
    rxBufferBytes,
    ...optionOverrides
  } = options;
  const opts: GrblSimOptions = { ...DEFAULT_GRBL_SIM_OPTIONS, ...optionOverrides };
  const settings = defaultGrblSimSettings();
  for (const [id, value] of settingOverrides ?? []) settings.set(id, value);

  const port = createFakeSerialPort();
  let state = initialGrblSimState(settings);

  const runEffect = (effect: GrblSimEffect): void => {
    if (effect.kind === 'emit') {
      setTimeout(() => port.emitLine(effect.line), effect.afterMs);
      return;
    }
    setTimeout(() => dispatch(effect.event), effect.afterMs);
  };

  const dispatch = (event: GrblSimEvent): void => {
    const reaction = reduceGrblSim(state, event, opts);
    state = reaction.state;
    for (const effect of reaction.effects) runEffect(effect);
  };

  const reduceLine = (line: string): ReadonlyArray<GrblSimEffect> => {
    const reaction = reduceGrblSim(state, { kind: 'rx-line', line }, opts);
    state = reaction.state;
    return reaction.effects;
  };

  const backpressure: BackpressureFeeder | null =
    plannerBlocks === undefined
      ? null
      : createBackpressureFeeder(
          {
            plannerBlocks,
            retireMs: blockRetireMs ?? opts.motionMs,
            rxCapacity: rxBufferBytes ?? GRBL_RX_USABLE_BYTES,
          },
          { reduceLine, runEffect, retireMotion: () => dispatch({ kind: 'motion-finished' }) },
        );
  const feeder: HostByteFeeder = backpressure ?? createImmediateFeeder(dispatch);
  const inertRxWindow = createRxWindow(0);
  const inertPlanner = createPlanner(0);

  port.onOpen(() => {
    feeder.reset();
    if (emitBannerOnOpen !== false) {
      setTimeout(() => port.emitLine(opts.firmwareBanner), opts.responseDelayMs);
    }
  });

  port.onWrite((data) => routeHostBytes(data, feeder, dispatch));

  return {
    adapter: port.adapter,
    port,
    state: () => state,
    outbound: () => port.outbound(),
    triggerAlarm: (code) => {
      state = { ...state, machine: 'Alarm', locked: true, pendingMotions: 0 };
      feeder.reset();
      setTimeout(() => port.emitLine(`ALARM:${code}`), opts.responseDelayMs);
    },
    yankCable: () => port.emitClose(),
    rxWindow: () => backpressure?.rxWindow() ?? inertRxWindow,
    planner: () => backpressure?.planner() ?? inertPlanner,
  };
}
