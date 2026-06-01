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
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { type AutofocusResult, runAutofocus } from './autofocus-action';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { handleLine, runHandshake } from './laser-line-handler';
import {
  resetOrigin as resetOriginAction,
  setOriginHere as setOriginHereAction,
  type WorkCoordinateOffset,
} from './origin-actions';

export type { AutofocusResult } from './autofocus-action';
export { describeAutofocusResult } from './autofocus-action';
export { hasCustomOrigin } from './origin-actions';
export type { WorkCoordinateOffset } from './origin-actions';

const DEFAULT_BAUD = 115200;
// Status poll tick. We tick at 250 ms always, but when no job is active
// we only emit a `?` every 4th tick (effective 1000 ms). MIT-T2 audit
// finding: CNCjs / LightBurn both ramp polling down when idle to cut
// serial chatter and CPU. While streaming/paused we keep the fast cadence
// so the live progress UI stays smooth.
const STATUS_POLL_MS = 250;
const IDLE_POLL_DIVISOR = 4;

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
  readonly lastWriteError: string | null;
  readonly streamer: StreamerState | null;
  readonly log: ReadonlyArray<string>;
  // F-7: settings auto-detected from the `$$` dump on connect. Non-null
  // means "the user hasn't responded to the detection banner yet" —
  // null after either Apply (which dispatched updateDeviceProfile) or
  // Dismiss (which left the profile alone).
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  /**
   * F.3 — last-seen Work Coordinate Offset from the GRBL controller.
   * GRBL only reports WCO on a cadence (~every Nth status frame), so
   * the UI needs the *last non-null* value cached here, not the raw
   * StatusReport.wco which is null on most frames. Updated by the
   * line-handler when a WCO-bearing status arrives; cleared on
   * disconnect, alarm, and soft reset (all of which clear G92 in
   * GRBL itself). UI reads `wcoCache`, NEVER `statusReport.wco`.
   */
  readonly wcoCache: WorkCoordinateOffset | null;
  readonly workOriginActive: boolean;

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
  readonly pauseJob: () => Promise<void>;
  readonly resumeJob: () => Promise<void>;
  readonly stopJob: () => Promise<void>;
  readonly applyDetectedSettings: () => void;
  readonly dismissDetectedSettings: () => void;
  // F.3 origin actions. setOriginHere sends G92 X0 Y0 (transient,
  // session-scoped); resetOrigin sends G92.1 to clear it. Cache
  // updates flow back through line-handler when GRBL's next
  // WCO-bearing status arrives.
  readonly setOriginHere: () => Promise<void>;
  readonly resetOrigin: () => Promise<void>;
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
  // R-L2: one-shot fired by handleLine the first time runHandshake's
  // race wants to observe a line. Held here so the shared `refs`
  // object handler functions receive carries it across calls.
  onLineArrived: (() => void) | null;
};

const refs: LiveRefs = {
  connection: null,
  unsubscribeLine: null,
  unsubscribeClose: null,
  pollHandle: null,
  settingsCollector: idleCollector(),
  onLineArrived: null,
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
  refs.onLineArrived = null;
}

function serialWriteErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeWrite(set: SetFn, get: GetFn, line: string): Promise<void> {
  const conn = refs.connection;
  if (conn === null) {
    const message = 'No active serial connection.';
    set({
      lastWriteError: message,
      log: pushLog(
        get(),
        `[lf2] Serial write failed: ${message}. Machine may not have received the command.`,
      ),
    });
    throw new Error(message);
  }
  try {
    await conn.write(line);
  } catch (err) {
    const message = serialWriteErrorMessage(err);
    set({
      lastWriteError: message,
      log: pushLog(
        get(),
        `[lf2] Serial write failed: ${message}. Machine may not have received the command.`,
      ),
    });
    console.error('Serial write failed:', err);
    throw err instanceof Error ? err : new Error(message);
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
  | 'lastWriteError'
  | 'streamer'
  | 'log'
  | 'detectedSettings'
  | 'controllerSettings'
  | 'wcoCache'
  | 'workOriginActive'
> {
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  };
}

function inferCurrentMachinePosition(state: LaserState): WorkCoordinateOffset | null {
  const report = state.statusReport;
  if (report?.mPos !== null && report?.mPos !== undefined) return report.mPos;
  if (report?.wPos !== null && report?.wPos !== undefined && state.wcoCache !== null) {
    return {
      x: report.wPos.x + state.wcoCache.x,
      y: report.wPos.y + state.wcoCache.y,
      z: report.wPos.z + state.wcoCache.z,
    };
  }
  return null;
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
        refs.unsubscribeLine = conn.onLine((line) =>
          handleLine(set, get, refs, (out) => safeWrite(set, get, out), line),
        );
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
            controllerSettings: null,
            // GRBL clears G92 on the reset that fires when the port
            // closes; our cache must match or the next connect will
            // show "custom origin" against an actually-zeroed machine.
            wcoCache: null,
            workOriginActive: false,
            streamer:
              s.streamer !== null &&
              (s.streamer.status === 'streaming' || s.streamer.status === 'paused')
                ? disconnectStreamer(s.streamer)
                : s.streamer,
          }));
        });
        let pollTick = 0;
        refs.pollHandle = setInterval(() => {
          pollTick++;
          const s = get();
          const isActive =
            s.streamer !== null &&
            (s.streamer.status === 'streaming' || s.streamer.status === 'paused');
          if (!isActive && pollTick % IDLE_POLL_DIVISOR !== 0) return;
          void safeWrite(set, get, RT_STATUS).catch(() => undefined);
        }, STATUS_POLL_MS);
        set({ connection: { kind: 'connected' }, alarmCode: null, lastWriteError: null });
        void runHandshake(set, get, refs, (out) => safeWrite(set, get, out)).catch(() => undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ connection: { kind: 'failed', error: message } });
      }
    },
    disconnect: async () => {
      const conn = refs.connection;
      teardown();
      if (conn !== null) await conn.close().catch(() => undefined);
      set({
        connection: { kind: 'disconnected' },
        statusReport: null,
        controllerSettings: null,
        streamer: null,
        wcoCache: null,
        workOriginActive: false,
        lastWriteError: null,
      });
    },
  };
}

function jogActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'home' | 'autofocus' | 'unlockAlarm' | 'jog' | 'cancelJog' | 'frame'> {
  return {
    home: async () => {
      await safeWrite(set, get, `${CMD_HOME}\n`);
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
      await safeWrite(set, get, `${CMD_UNLOCK}\n`);
      set({ alarmCode: null });
    },
    jog: async (params) => {
      await safeWrite(set, get, `${buildJogCommand(params)}\n`);
    },
    cancelJog: async () => {
      await safeWrite(set, get, RT_JOG_CANCEL);
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
        await safeWrite(set, get, `$J=G90 G21 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`);
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
      if (stepped.toSend.length > 0) await safeWrite(set, get, stepped.toSend);
      set({ streamer: stepped.state });
    },
    pauseJob: async () => {
      await safeWrite(set, get, RT_HOLD);
      const s = get().streamer;
      if (s !== null) set({ streamer: pauseStreamer(s) });
    },
    resumeJob: async () => {
      await safeWrite(set, get, RT_RESUME);
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
      if (toSend.length > 0) await safeWrite(set, get, toSend);
    },
    stopJob: async () => {
      await safeWrite(set, get, RT_SOFT_RESET);
      // Soft reset clears G92 in GRBL (alarm 1 reaction). Drop our
      // cached WCO so the readout doesn't lie about "custom origin"
      // until the next WCO frame arrives. Same race window as
      // resumeJob — use functional set.
      set((s) => ({
        wcoCache: null,
        workOriginActive: false,
        streamer: s.streamer !== null ? cancelStreamer(s.streamer) : s.streamer,
      }));
    },
  };
}

function originActions(set: SetFn, get: GetFn): Pick<LaserState, 'setOriginHere' | 'resetOrigin'> {
  // Set the local active flag immediately after a successful write.
  // The line-handler still reconciles the exact WCO later, but Frame/Start
  // need to switch placement as soon as the write succeeds.
  return {
    setOriginHere: async () => {
      await setOriginHereAction((out) => safeWrite(set, get, out));
      const inferredWco = inferCurrentMachinePosition(get());
      set({
        workOriginActive: true,
        ...(inferredWco !== null ? { wcoCache: inferredWco } : {}),
      });
    },
    resetOrigin: async () => {
      await resetOriginAction((out) => safeWrite(set, get, out));
      set({ workOriginActive: false, wcoCache: null });
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
  ...originActions(set, get),
  ...detectedSettingsActions(set, get),
}));
