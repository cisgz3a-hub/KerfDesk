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
  CMD_UNLOCK,
  RT_HOLD,
  RT_JOG_CANCEL,
  RT_RESUME,
  RT_SOFT_RESET,
  RT_STATUS,
  buildJogCommand,
  cancel as cancelStreamer,
  createStreamer,
  disconnect as disconnectStreamer,
  idleCollector,
  type JogParams,
  pause as pauseStreamer,
  resume as resumeStreamer,
  type SettingsCollectorState,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { type AutofocusResult, runAutofocus } from './autofocus-action';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { handleLine, runHandshake } from './laser-line-handler';

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
        refs.unsubscribeLine = conn.onLine((line) => handleLine(set, get, refs, safeWrite, line));
        refs.unsubscribeClose = conn.onClose(() => {
          teardown();
          // If a job was streaming or paused when the port dropped, mark
          // the streamer 'disconnected' so the UI shows "connection lost
          // mid-job" instead of leaving a stale 'streaming' state behind.
          // MIT-T1 audit finding (CNCjs parity). Functional set form so
          // we don't clobber any concurrent ack-driven update — same
          // pattern as R-H2's resume/stop fix.
          set((s) => ({
            connection: { kind: 'disconnected' },
            statusReport: null,
            streamer:
              s.streamer !== null &&
              (s.streamer.status === 'streaming' || s.streamer.status === 'paused')
                ? disconnectStreamer(s.streamer)
                : s.streamer,
          }));
        });
        refs.pollHandle = setInterval(() => {
          void safeWrite(RT_STATUS);
        }, STATUS_POLL_MS);
        set({ connection: { kind: 'connected' }, alarmCode: null });
        void runHandshake(set, get, refs, safeWrite);
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
      // Functional set so the snapshot is taken AT WRITE TIME — during
      // the await above, ack-driven handleLine paths can have advanced
      // the streamer via advanceStream. A `const s = get().streamer`
      // before the set would clobber those concurrent updates with a
      // state derived from a stale snapshot, drifting the in-flight
      // accounting against the real GRBL 127-byte buffer (R-H2 audit
      // finding). On a laser cutter, accounting drift can push more
      // bytes than the buffer holds → dropped commands → uncontrolled
      // head motion.
      let toSend = '';
      set((s) => {
        if (s.streamer === null) return s;
        const stepped = step(resumeStreamer(s.streamer));
        toSend = stepped.toSend;
        return { streamer: stepped.state };
      });
      if (toSend.length > 0) await safeWrite(toSend);
    },
    stopJob: async () => {
      await safeWrite(RT_SOFT_RESET);
      // Same race window as resumeJob — use functional set so the
      // cancel applies to the current state, not a pre-await snapshot.
      set((s) => (s.streamer !== null ? { streamer: cancelStreamer(s.streamer) } : s));
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
