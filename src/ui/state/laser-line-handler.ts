// Line-receive pipeline extracted from laser-store so that file stays
// under the 400-line hard cap (CLAUDE.md ADR-015). Three responsibilities
// — they're cohesive because each fires per inbound serial line:
//
//   runHandshake  — waits up to 2 s after connect for any GRBL reply;
//                   if anything arrives, sends `$$` to harvest settings.
//   handleLine    — classifies an inbound line, feeds the settings
//                   collector, fans the result into LaserState (status,
//                   alarm, error), and drives the streamer's ack loop.
//   advanceStream — pops the head-of-flight line from the streamer and
//                   pushes the next eligible bytes if buffer allows.
//
// All three take the shared mutable `refs` object by reference (same
// instance laser-store creates) so the settings-collector state is
// observable across calls. Pure ports of the previous in-file logic;
// no behavior change.

import {
  classifyResponse,
  CMD_SETTINGS,
  disconnect as disconnectStreamer,
  onAck,
  type SettingsCollectorState,
  startCollecting,
  step,
  type StreamerState,
} from '../../core/controllers/grbl';
import { consumeSettingsResponse } from './detected-settings-action';
import {
  controllerErrorNotice,
  disconnectDuringJobNotice,
  type ControllerErrorContext,
} from './laser-safety-notice';
import { observeMotionStatus } from './laser-motion-operation';
import type { LaserState } from './laser-store';
import { hasCustomOrigin } from './origin-actions';

export type HandlerRefs = {
  settingsCollector: SettingsCollectorState;
  // One-shot callback fired by handleLine the next time any line arrives.
  // runHandshake sets it before awaiting; handleLine clears it after
  // calling. Lets the handshake be event-driven instead of busy-polling
  // get().log.length on a 50 ms loop (R-L2 audit finding — the old loop
  // was brittle under vi.useFakeTimers and burnt CPU during the
  // 2-second connect window).
  onLineArrived: (() => void) | null;
};

export type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
export type GetFn = () => LaserState;

// Append a log line with a fixed history cap. Same constant as
// laser-store's own pushLog — duplicated rather than re-exported
// because importing it would create a circular store ↔ handler
// dependency. 200 lines is plenty for diagnostics without holding
// onto a session's worth of GRBL chatter.
const LOG_MAX = 200;
function appendLog(state: LaserState, line: string): ReadonlyArray<string> {
  return [...state.log, line].slice(-LOG_MAX);
}

export async function runHandshake(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: (line: string) => Promise<void>,
): Promise<void> {
  const HANDSHAKE_TIMEOUT_MS = 2000;
  // Race a single deadline timer against a one-shot resolved by
  // handleLine. No busy-polling get().log.length and no reliance on
  // Date.now() advancement — both clean under fake-time testing.
  const gotLine = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      refs.onLineArrived = null;
      resolve(false);
    }, HANDSHAKE_TIMEOUT_MS);
    refs.onLineArrived = (): void => {
      clearTimeout(timer);
      refs.onLineArrived = null;
      resolve(true);
    };
  });

  if (!gotLine) {
    set({
      log: appendLog(
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
    log: appendLog(get(), '[lf2] Connected. Querying settings ($$)…'),
    detectedSettings: null,
    controllerSettings: null,
  });
  refs.settingsCollector = startCollecting();
  await safeWrite(`${CMD_SETTINGS}\n`);
}

export function handleLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: (line: string) => Promise<void>,
  line: string,
): void {
  const cls = classifyResponse(line);
  // Always log the raw line for the user-visible console.
  set({ log: appendLog(get(), line) });
  // R-L2: fire + clear the one-shot the moment any line lands so
  // runHandshake's Promise.race resolves event-driven instead of polling.
  if (refs.onLineArrived !== null) {
    const cb = refs.onLineArrived;
    refs.onLineArrived = null;
    cb();
  }
  // F-7: feed every classified response to the settings collector.
  // Returns a patch only when the `$$` response window just closed.
  const patch = consumeSettingsResponse(refs, cls);
  if (patch !== null) set({ detectedSettings: patch, controllerSettings: patch });
  if (cls.kind === 'status') {
    const operation = get().motionOperation;
    const streamer = get().streamer;
    const nextOperation = observeMotionStatus(operation, cls.report.state);
    const operationPatch = operation === nextOperation ? {} : { motionOperation: nextOperation };
    const completedStreamerPatch =
      streamer?.status === 'done' && cls.report.state === 'Idle' ? { streamer: null } : {};
    // Cache WCO across frames — GRBL only reports it intermittently
    // (every Nth status per `$10`'s WCO bit). UI reads `wcoCache`,
    // never `statusReport.wco`. F.3 / ADR-021.
    if (cls.report.wco !== null) {
      set({
        statusReport: cls.report,
        wcoCache: cls.report.wco,
        workOriginActive: hasCustomOrigin(cls.report.wco),
        ...operationPatch,
        ...completedStreamerPatch,
      });
    } else {
      set({ statusReport: cls.report, ...operationPatch, ...completedStreamerPatch });
    }
    return;
  }
  if (cls.kind === 'alarm') {
    // GRBL clears G92 on alarm (1 — hard limit; soft-resets internally).
    // Mirror that in our cache so the readout stops claiming a custom
    // origin is active. F.3 / ADR-021.
    set({ alarmCode: cls.code, wcoCache: null, workOriginActive: false, motionOperation: null });
    advanceStream(set, get, safeWrite, 'alarm');
    return;
  }
  if (cls.kind === 'error') {
    // P0-1: a controller rejection is terminal. onAck() marks the streamer
    // 'errored' so step() sends no further bytes; raise a safety notice so the
    // operator checks the machine - the rejected move may have left the head
    // mispositioned and a laser-on line could have fired out of place.
    const state = get();
    set({
      lastError: cls.code,
      safetyNotice: controllerErrorNotice(cls.code, controllerErrorContext(state)),
    });
    advanceStream(set, get, safeWrite, 'error');
    return;
  }
  if (cls.kind === 'ok') {
    advanceStream(set, get, safeWrite, 'ok');
    return;
  }
  // welcome / message / setting / unknown — already logged.
}

function advanceStream(
  set: SetFn,
  get: GetFn,
  safeWrite: (line: string) => Promise<void>,
  ack: 'ok' | 'error' | 'alarm',
): void {
  const s: StreamerState | null = get().streamer;
  if (s === null) return;
  const acked = onAck(s, ack);
  const stepped = step(acked.state);
  set({ streamer: stepped.state });
  if (stepped.toSend.length > 0) {
    void safeWrite(stepped.toSend).catch(() => {
      // P0-3: the follow-up write failed mid-job. GRBL may keep executing the
      // commands already in its buffer, so mark the streamer disconnected AND
      // raise the operator-facing safety banner (this path used to tear down
      // silently). No soft-reset: the write itself failed, so there is no live
      // link to send one over.
      set({
        streamer: disconnectStreamer(acked.state),
        safetyNotice: disconnectDuringJobNotice(),
      });
    });
  }
}

function controllerErrorContext(state: LaserState): ControllerErrorContext {
  if (state.streamer !== null) return 'job';
  if (state.motionOperation?.kind === 'frame') return 'frame';
  if (state.motionOperation?.kind === 'jog') return 'jog';
  return 'command';
}
