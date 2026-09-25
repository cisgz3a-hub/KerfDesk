// grbl-simulator — wires the pure GRBL firmware reducer onto a fake serial
// port with real (fake-timer-friendly) scheduling. Responses are emitted via
// setTimeout so host write-bookkeeping always completes before the firmware
// answers, exactly like real serial latency. Run tests under vi.useFakeTimers
// and drive with vi.advanceTimersByTimeAsync.
//
// Host bytes land in an RX ring and the main loop reads a line only while the
// firmware model parses lines (grblSimParsesLines): a G4 or M0 in progress, a
// completed feed hold or door, homing, sleep and a stock critical alarm all
// leave later lines waiting in the ring, as on GRBL 1.1h.
//
// Planner back-pressure is OPT-IN (ADR-265). Pass `plannerBlocks` and the
// simulator withholds `ok` while its planner is full, exactly as real GRBL
// does — the failure mode a character-counting sender exists to prevent. Left
// unset, the simulator acks immediately as it always has, so the existing
// byte-level transcript characterizations stay unchanged. See
// `grbl-sim-backpressure.ts` for the firmware citations.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import { createBackpressureFeeder } from './grbl-sim-backpressure';
import {
  DEFAULT_GRBL_SIM_OPTIONS,
  grblSimParsesLines,
  initialGrblSimState,
  reduceGrblSim,
  type GrblSimEffect,
  type GrblSimEvent,
  type GrblSimOptions,
  type GrblSimState,
} from './grbl-sim-machine';
import { createPlanner, type GrblSimPlanner } from './grbl-sim-planner';
import {
  acceptRxBytes,
  createRxWindow,
  GRBL_RX_USABLE_BYTES,
  takeRxLine,
  type GrblSimLineEnding,
  type GrblSimRxWindow,
} from './grbl-sim-rx-window';
import { defaultGrblSimSettings } from './grbl-sim-settings';
import type { PlatformAdapter } from '../../platform/types';

// grbl serial.c ISR: `?`, `!`, `~` and Ctrl-X, plus every byte above 0x7F
// (door, jog cancel, overrides, unassigned), are taken off the stream and
// never stored in the RX ring (serial.c:150-196).
const ASCII_REALTIME_BYTES = new Set(['?', '!', '~', '\x18']);
const SOFT_RESET_BYTE = '\x18';

export type CreateGrblSimulatorOptions = Partial<GrblSimOptions> & {
  /** Override or extend the default $$ settings table. */
  readonly settings?: ReadonlyArray<readonly [number, string]>;
  /** Emit the welcome banner when the port opens (default true). */
  readonly emitBannerOnOpen?: boolean;
  /**
   * Model GRBL's bounded planner with this many motion blocks (stock grbl 1.1
   * has 15 usable, GRBL_PLANNER_BLOCKS). Unset means acks stay immediate — the
   * historical behaviour.
   */
  readonly plannerBlocks?: number;
  /** Simulated time one planner block takes to retire. Defaults to `motionMs`. */
  readonly blockRetireMs?: number;
  /** Usable RX ring bytes. Defaults to grbl's 128. */
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

type HostByteFeeder = {
  /** Deliver non-realtime host bytes into the RX ring, then read what the main loop can. */
  readonly acceptBytes: (data: string) => void;
  /** Read every complete line the main loop takes now. */
  readonly drain: () => void;
  /** Soft reset: the RX ring is flushed and queued motion dropped. */
  readonly reset: () => void;
  /** An alarm without a reset: queued motion dropped, the RX ring kept. */
  readonly wipePlanner: () => void;
};

type FeederDeps = {
  readonly reduceLine: (line: string) => ReadonlyArray<GrblSimEffect>;
  readonly runEffect: (effect: GrblSimEffect) => void;
  readonly parsesLines: () => boolean;
  readonly lineEnding: GrblSimLineEnding;
};

/** The zero-latency path: a complete line is consumed as soon as the main loop reads. */
function createImmediateFeeder(deps: FeederDeps): HostByteFeeder {
  let rx = createRxWindow(Number.POSITIVE_INFINITY);
  const drain = (): void => {
    while (deps.parsesLines()) {
      const taken = takeRxLine(rx, deps.lineEnding);
      rx = taken.window;
      if (taken.line === null) return;
      for (const effect of deps.reduceLine(taken.line)) deps.runEffect(effect);
    }
  };
  return {
    acceptBytes: (data) => {
      rx = acceptRxBytes(rx, data);
      drain();
    },
    drain,
    reset: () => {
      rx = createRxWindow(Number.POSITIVE_INFINITY);
    },
    wipePlanner: () => undefined,
  };
}

function isRealtimeByte(ch: string): boolean {
  return ASCII_REALTIME_BYTES.has(ch) || ch.charCodeAt(0) > 0x7f;
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
  onRealtime: (byte: string) => void,
): void {
  let buffered = '';
  for (const ch of data) {
    if (!isRealtimeByte(ch)) {
      buffered += ch;
      continue;
    }
    feeder.acceptBytes(buffered);
    buffered = '';
    onRealtime(ch);
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

  const apply = (event: GrblSimEvent): void => {
    const reaction = reduceGrblSim(state, event, opts);
    state = reaction.state;
    for (const effect of reaction.effects) runEffect(effect);
  };

  // An event can unblock the main loop (a dwell ends, cycle start, homing
  // done), so the ring is read again after every one.
  const dispatch = (event: GrblSimEvent): void => {
    apply(event);
    feeder.drain();
  };

  const deps: FeederDeps = {
    reduceLine: (line) => {
      const reaction = reduceGrblSim(state, { kind: 'rx-line', line }, opts);
      state = reaction.state;
      return reaction.effects;
    },
    runEffect,
    parsesLines: () => grblSimParsesLines(state, opts),
    lineEnding: opts.firmware === 'grblhal' ? 'pair' : 'each',
  };

  const backpressure =
    plannerBlocks === undefined
      ? null
      : createBackpressureFeeder(
          {
            plannerBlocks,
            retireMs: blockRetireMs ?? opts.motionMs,
            rxCapacity: rxBufferBytes ?? GRBL_RX_USABLE_BYTES,
          },
          // The feeder reads the ring itself once a retired block frees the
          // main loop, after it releases the withheld ack.
          { ...deps, retireMotion: () => apply({ kind: 'motion-finished' }) },
        );
  const feeder: HostByteFeeder = backpressure ?? createImmediateFeeder(deps);
  const inertRxWindow = createRxWindow(0);
  const inertPlanner = createPlanner(0);

  const onRealtime = (byte: string): void => {
    apply({ kind: 'rx-realtime', byte });
    // A soft reset flushes the receive buffer and the planner on real hardware.
    if (byte === SOFT_RESET_BYTE) feeder.reset();
    feeder.drain();
  };

  port.onOpen(() => {
    feeder.reset();
    if (emitBannerOnOpen !== false) {
      setTimeout(() => port.emitLine(opts.firmwareBanner), opts.responseDelayMs);
    }
  });

  port.onWrite((data) => routeHostBytes(data, feeder, onRealtime));

  return {
    adapter: port.adapter,
    port,
    state: () => state,
    outbound: () => port.outbound(),
    triggerAlarm: (code) => {
      apply({ kind: 'alarm', code });
      // grblHAL resets its read buffer on a critical alarm (protocol.c:491);
      // stock GRBL keeps the bytes until the reset re-initializes it.
      const critical = code === 1 || code === 2;
      if (critical && opts.firmware === 'grblhal') feeder.reset();
      else feeder.wipePlanner();
      feeder.drain();
    },
    yankCable: () => port.emitClose(),
    rxWindow: () => backpressure?.rxWindow() ?? inertRxWindow,
    planner: () => backpressure?.planner() ?? inertPlanner,
  };
}
