// grbl-simulator — wires the pure GRBL firmware reducer onto a fake serial
// port with real (fake-timer-friendly) scheduling. Responses are emitted via
// setTimeout so host write-bookkeeping always completes before the firmware
// answers, exactly like real serial latency. Run tests under vi.useFakeTimers
// and drive with vi.advanceTimersByTimeAsync.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import {
  DEFAULT_GRBL_SIM_OPTIONS,
  initialGrblSimState,
  reduceGrblSim,
  type GrblSimEffect,
  type GrblSimEvent,
  type GrblSimOptions,
  type GrblSimState,
} from './grbl-sim-machine';
import { defaultGrblSimSettings } from './grbl-sim-settings';
import type { PlatformAdapter } from '../../platform/types';

const REALTIME_BYTES = new Set(['?', '!', '~', '\x18', '\x84', '\x85']);

export type CreateGrblSimulatorOptions = Partial<GrblSimOptions> & {
  /** Override or extend the default $$ settings table. */
  readonly settings?: ReadonlyArray<readonly [number, string]>;
  /** Emit the welcome banner when the port opens (default true). */
  readonly emitBannerOnOpen?: boolean;
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
};

export function createGrblSimulator(options: CreateGrblSimulatorOptions = {}): GrblSimulator {
  const { settings: settingOverrides, emitBannerOnOpen, ...optionOverrides } = options;
  const opts: GrblSimOptions = { ...DEFAULT_GRBL_SIM_OPTIONS, ...optionOverrides };
  const settings = defaultGrblSimSettings();
  for (const [id, value] of settingOverrides ?? []) settings.set(id, value);

  const port = createFakeSerialPort();
  let state = initialGrblSimState(settings);
  let rxBuffer = '';

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

  port.onOpen(() => {
    rxBuffer = '';
    if (emitBannerOnOpen !== false) {
      setTimeout(() => port.emitLine(opts.firmwareBanner), opts.responseDelayMs);
    }
  });

  port.onWrite((data) => {
    for (const ch of data) {
      if (REALTIME_BYTES.has(ch)) {
        dispatch({ kind: 'rx-realtime', byte: ch });
        continue;
      }
      if (ch === '\n') {
        const line = rxBuffer.trim();
        rxBuffer = '';
        dispatch({ kind: 'rx-line', line });
        continue;
      }
      if (ch !== '\r') rxBuffer += ch;
    }
  });

  return {
    adapter: port.adapter,
    port,
    state: () => state,
    outbound: () => port.outbound(),
    triggerAlarm: (code) => {
      state = { ...state, machine: 'Alarm', locked: true, pendingMotions: 0 };
      setTimeout(() => port.emitLine(`ALARM:${code}`), opts.responseDelayMs);
    },
    yankCable: () => port.emitClose(),
  };
}
