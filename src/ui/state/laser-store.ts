// laser-store — Zustand store for the live serial connection to the GRBL
// controller. Holds the SerialConnection in a closure (out-of-band from the
// React-observable state) so 60-Hz status updates don't churn the React
// tree any more than necessary. Components subscribe to `connection`,
// `statusReport`, `alarmCode`, and `streamer` for live UI updates.
//
// Status polling: every 250 ms while connected we write '?' to the port.
// GRBL replies with <Idle|...> or <Run|...>, which the classifier turns into
// `kind: 'status'` and the store fans into `statusReport`.

import { create } from 'zustand';
import {
  CMD_HOME,
  CMD_SETTINGS,
  CMD_UNLOCK,
  RT_HOLD,
  RT_JOG_CANCEL,
  RT_RESUME,
  RT_SOFT_RESET,
  RT_STATUS,
  buildJogCommand,
  cancel as cancelStreamer,
  classifyResponse,
  createStreamer,
  idleCollector,
  type JogParams,
  onAck,
  pause as pauseStreamer,
  resume as resumeStreamer,
  type SettingsCollectorState,
  startCollecting,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { type AutofocusResult, runAutofocus } from './autofocus-action';
import {
  applyDetectedSettingsPatch,
  consumeSettingsResponse,
} from './detected-settings-action';

export type { AutofocusResult } from './autofocus-action';
export { describeAutofocusResult } from './autofocus-action';

const DEFAULT_BAUD = 115200;
const STATUS_POLL_MS = 250;

export type ConnectionState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | { readonly kind: 'failed'; readonly error: string };

export type LaserState = {
  readonly connection: ConnectionState;
  readonly statusReport: StatusReport | null;
  readonly alarmCode: number | null;
  readonly lastError: number | null;
  readonly streamer: StreamerState | null;
  readonly log: ReadonlyArray<string>;
  // F-7: settings auto-detected from the `$$` dump on connect. Non-null
  // means "the user hasn't responded to the detection banner yet" —
  // null after either Apply (which dispatched updateDeviceProfile) or
  // Dismiss (which left the profile alone).
  readonly detectedSettings: Partial<DeviceProfile> | null;

  readonly connect: (adapter: PlatformAdapter) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly home: () => Promise<void>;
  readonly autofocus: (command: string) => Promise<AutofocusResult>;
  readonly unlockAlarm: () => Promise<void>;
  readonly jog: (params: JogParams) => Promise<void>;
  readonly cancelJog: () => Promise<void>;
  readonly frame: (
    bounds: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    },
    feed: number,
  ) => Promise<void>;
  readonly startJob: (gcode: string) => Promise<void>;
  readonly pauseJob: () => void;
  readonly resumeJob: () => Promise<void>;
  readonly stopJob: () => Promise<void>;
  readonly applyDetectedSettings: () => void;
  readonly dismissDetectedSettings: () => void;
};

// Live state held outside Zustand. The connection / pollHandle references are
// imperative; only their *effects* (state report, alarm, streamer progress)
// flow into the React-observable state above.
type LiveRefs = {
  connection: SerialConnection | null;
  unsubscribeLine: (() => void) | null;
  unsubscribeClose: (() => void) | null;
  pollHandle: ReturnType<typeof setInterval> | null;
  // F-7: pure state machine collecting the `$$` settings dump. Kept
  // out of the React-observable state because every interim setting
  // line would otherwise re-render Laser components for no reason —
  // only the final `done` patch matters to the UI.
  settingsCollector: SettingsCollectorState;
};

const refs: LiveRefs = {
  connection: null,
  unsubscribeLine: null,
  unsubscribeClose: null,
  pollHandle: null,
  settingsCollector: idleCollector(),
};

const LOG_MAX = 200;

function pushLog(state: LaserState, line: string): ReadonlyArray<string> {
  return [...state.log, line].slice(-LOG_MAX);
}

function teardown(): void {
  refs.unsubscribeLine?.();
  refs.unsubscribeClose?.();
  if (refs.pollHandle !== null) clearInterval(refs.pollHandle);
  refs.connection = null;
  refs.unsubscribeLine = null;
  refs.unsubscribeClose = null;
  refs.pollHandle = null;
  refs.settingsCollector = idleCollector();
}

async function safeWrite(line: string): Promise<void> {
  const conn = refs.connection;
  if (conn === null) return;
  try {
    await conn.write(line);
  } catch (err) {
    console.error('Serial write failed:', err);
  }
}

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

function initialLaserState(): Pick<
  LaserState,
  | 'connection'
  | 'statusReport'
  | 'alarmCode'
  | 'lastError'
  | 'streamer'
  | 'log'
  | 'detectedSettings'
> {
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    streamer: null,
    log: [],
    detectedSettings: null,
  };
}

function connectionActions(set: SetFn, get: GetFn): Pick<LaserState, 'connect' | 'disconnect'> {
  return {
    connect: async (adapter) => {
      set({ connection: { kind: 'connecting' }, log: [] });
      const portRef = await adapter.serial.requestPort();
      if (portRef === null) {
        set({ connection: { kind: 'disconnected' } });
        return;
      }
      try {
        const conn = await portRef.open({ baudRate: DEFAULT_BAUD });
        refs.connection = conn;
        refs.unsubscribeLine = conn.onLine((line) => handleLine(set, get, line));
        refs.unsubscribeClose = conn.onClose(() => {
          teardown();
          set({ connection: { kind: 'disconnected' }, statusReport: null });
        });
        refs.pollHandle = setInterval(() => {
          void safeWrite(RT_STATUS);
        }, STATUS_POLL_MS);
        set({ connection: { kind: 'connected' }, alarmCode: null });
        void runHandshake(set, get);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ connection: { kind: 'failed', error: message } });
      }
    },
    disconnect: async () => {
      const conn = refs.connection;
      teardown();
      if (conn !== null) await conn.close().catch(() => undefined);
      set({ connection: { kind: 'disconnected' }, statusReport: null, streamer: null });
    },
  };
}

function jogActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'home' | 'autofocus' | 'unlockAlarm' | 'jog' | 'cancelJog' | 'frame'> {
  return {
    home: async () => {
      await safeWrite(`${CMD_HOME}\n`);
    },
    autofocus: async (command) => {
      // Delegates to the protocol-aware runner (autofocus-action.ts).
      // The runner subscribes to incoming lines, waits for ok / error /
      // status transitions, and times out at 15s — fire-and-forget
      // (the old behavior) was the entire reason previous attempts
      // looked "hung" or fired the wrong command silently.
      return runAutofocus({
        connection: refs.connection,
        statusReport: get().statusReport,
        command,
      });
    },
    unlockAlarm: async () => {
      await safeWrite(`${CMD_UNLOCK}\n`);
      set({ alarmCode: null });
    },
    jog: async (params) => {
      await safeWrite(`${buildJogCommand(params)}\n`);
    },
    cancelJog: async () => {
      await safeWrite(RT_JOG_CANCEL);
    },
    frame: async (bounds, feed) => {
      const f = Math.max(1, Math.round(feed));
      const fmt = (n: number): string => n.toFixed(3);
      const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.minY },
      ];
      for (const c of corners) {
        await safeWrite(`$J=G90 G21 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`);
      }
    },
  };
}

function jobActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob'> {
  return {
    startJob: async (gcode) => {
      const initial = createStreamer(gcode);
      const stepped = step(initial);
      set({ streamer: stepped.state });
      if (stepped.toSend.length > 0) await safeWrite(stepped.toSend);
    },
    pauseJob: () => {
      void safeWrite(RT_HOLD);
      const s = get().streamer;
      if (s !== null) set({ streamer: pauseStreamer(s) });
    },
    resumeJob: async () => {
      await safeWrite(RT_RESUME);
      const s = get().streamer;
      if (s !== null) {
        const resumed = resumeStreamer(s);
        const stepped = step(resumed);
        set({ streamer: stepped.state });
        if (stepped.toSend.length > 0) await safeWrite(stepped.toSend);
      }
    },
    stopJob: async () => {
      await safeWrite(RT_SOFT_RESET);
      const s = get().streamer;
      if (s !== null) set({ streamer: cancelStreamer(s) });
    },
  };
}

function detectedSettingsActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'applyDetectedSettings' | 'dismissDetectedSettings'> {
  return {
    applyDetectedSettings: () => {
      const patch = get().detectedSettings;
      if (!applyDetectedSettingsPatch(patch)) return;
      set({
        detectedSettings: null,
        log: pushLog(get(), '[lf2] Applied detected machine settings to device profile.'),
      });
    },
    dismissDetectedSettings: () => set({ detectedSettings: null }),
  };
}

export const useLaserStore = create<LaserState>((set, get) => ({
  ...initialLaserState(),
  ...connectionActions(set, get),
  ...jogActions(set, get),
  ...jobActions(set, get),
  ...detectedSettingsActions(set, get),
}));

// Validates the connection by waiting up to HANDSHAKE_TIMEOUT_MS for *any*
// response from GRBL (welcome banner or first status poll reply). If something
// comes back, we follow up with `$$` so the operator can see the live
// settings in the log. If nothing comes back, we surface a clear "no
// response" message so a wrong-baud or non-GRBL device doesn't silently
// look "Connected" (audit finding I-3).
async function runHandshake(set: SetFn, get: GetFn): Promise<void> {
  const HANDSHAKE_TIMEOUT_MS = 2000;
  const POLL_MS = 50;
  const start = Date.now();
  const startLen = get().log.length;
  while (Date.now() - start < HANDSHAKE_TIMEOUT_MS) {
    if (get().log.length > startLen) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (get().log.length === startLen) {
    set({
      log: pushLog(
        get(),
        '[lf2] No GRBL response within 2 s. Check baud rate (115200) and that the device is GRBL.',
      ),
    });
    return;
  }
  // Got a reply — query settings so the operator can see $30, $32, etc.
  // Reset detectedSettings + arm the collector first so handleLine can
  // build up the patch as setting lines stream in. The collector closes
  // on the trailing `ok` that GRBL emits at the end of $$.
  set({
    log: pushLog(get(), '[lf2] Connected. Querying settings ($$)…'),
    detectedSettings: null,
  });
  refs.settingsCollector = startCollecting();
  await safeWrite(`${CMD_SETTINGS}\n`);
}

function handleLine(
  set: (partial: Partial<LaserState>) => void,
  get: () => LaserState,
  line: string,
): void {
  const cls = classifyResponse(line);
  // Always log the raw line for the user-visible console. Truncated above.
  set({ log: pushLog(get(), line) });
  // F-7: feed every classified response to the settings collector.
  // Returns a patch only when the `$$` response window just closed.
  const patch = consumeSettingsResponse(refs, cls);
  if (patch !== null) set({ detectedSettings: patch });
  if (cls.kind === 'status') {
    set({ statusReport: cls.report });
    return;
  }
  if (cls.kind === 'alarm') {
    set({ alarmCode: cls.code });
    advanceStream(set, get, 'alarm');
    return;
  }
  if (cls.kind === 'error') {
    set({ lastError: cls.code });
    advanceStream(set, get, 'error');
    return;
  }
  if (cls.kind === 'ok') {
    advanceStream(set, get, 'ok');
    return;
  }
  // welcome / message / setting / unknown — already logged.
}

function advanceStream(
  set: (partial: Partial<LaserState>) => void,
  get: () => LaserState,
  ack: 'ok' | 'error' | 'alarm',
): void {
  const s = get().streamer;
  if (s === null) return;
  const acked = onAck(s, ack);
  const stepped = step(acked.state);
  set({ streamer: stepped.state });
  if (stepped.toSend.length > 0) void safeWrite(stepped.toSend);
}
