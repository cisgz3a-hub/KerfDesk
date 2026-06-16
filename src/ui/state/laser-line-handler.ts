// Line-receive pipeline extracted from laser-store so that file stays
// under the 400-line hard cap (CLAUDE.md ADR-015). Three responsibilities:
//
//   runHandshake - waits up to 2 s after connect for any GRBL reply;
//                  if anything arrives, sends `$$` to harvest settings.
//   handleLine   - classifies an inbound line, feeds the settings
//                  collector, fans the result into LaserState (status,
//                  alarm, error), and drives the streamer's ack loop.
//   advanceStream - pops the head-of-flight line from the streamer and
//                   pushes the next eligible bytes if buffer allows.
//
// All three take the shared mutable `refs` object by reference (same
// instance laser-store creates) so the settings-collector state is
// observable across calls. Pure ports of the previous in-file logic;
// no behavior change.

import {
  classifyResponse,
  CMD_SETTINGS,
  markErrored,
  onAck,
  type SettingsCollectorState,
  startCollecting,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { consumeSettingsResponse } from './detected-settings-action';
import {
  controllerErrorNotice,
  disconnectDuringJobNotice,
  type ControllerErrorContext,
  type LaserSafetyAction,
} from './laser-safety-notice';
import {
  markMotionOperationDispatched,
  observeMotionStatus,
  takeNextFrameJogLine,
} from './laser-motion-operation';
import type { LaserState } from './laser-store';
import { appendTranscript, inboundTranscriptEntry } from './laser-transcript';
import { hasCustomOrigin } from './origin-actions';

export type HandlerRefs = {
  settingsCollector: SettingsCollectorState;
  // One-shot callback fired by handleLine the next time any line arrives.
  // runHandshake sets it before awaiting; handleLine clears it after
  // calling. Lets the handshake be event-driven instead of busy-polling
  // get().log.length on a 50 ms loop (R-L2 audit finding).
  onLineArrived: (() => void) | null;
  nextTranscriptId?: number;
};

export type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
export type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

const LOG_MAX = 200;

function appendLog(state: LaserState, line: string): ReadonlyArray<string> {
  return [...state.log, line].slice(-LOG_MAX);
}

export async function runHandshake(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  const HANDSHAKE_TIMEOUT_MS = 2000;
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
  set({
    log: appendLog(get(), '[lf2] Connected. Querying settings ($$)...'),
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  refs.settingsCollector = startCollecting();
  await safeWrite(`${CMD_SETTINGS}\n`);
}

export function handleLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  line: string,
): void {
  const cls = classifyResponse(line);
  const state = get();
  set({
    log: appendLog(state, line),
    transcript: appendTranscript(
      state.transcript,
      inboundTranscriptEntry(nextTranscriptId(refs), Date.now(), line),
    ),
  });
  if (refs.onLineArrived !== null) {
    const cb = refs.onLineArrived;
    refs.onLineArrived = null;
    cb();
  }
  const detected = consumeSettingsResponse(refs, cls);
  if (detected !== null) {
    set({
      detectedSettings: Object.keys(detected.patch).length > 0 ? detected.patch : null,
      controllerSettings: detected.controllerSettings,
      grblSettingsRows: detected.settingsRows,
      lastSettingsReadAt: Date.now(),
    });
  }
  if (cls.kind === 'status') {
    handleStatusLine(set, get, safeWrite, cls.report);
    return;
  }
  if (cls.kind === 'alarm') {
    set({
      alarmCode: cls.code,
      wcoCache: null,
      workOriginActive: false,
      homingState: 'unknown',
      motionOperation: null,
    });
    advanceStream(set, get, safeWrite, 'alarm');
    return;
  }
  if (cls.kind === 'error') {
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
  }
}

function nextTranscriptId(refs: HandlerRefs): number {
  const id = refs.nextTranscriptId ?? 1;
  refs.nextTranscriptId = id + 1;
  return id;
}

function handleStatusLine(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  report: StatusReport,
): void {
  const state = get();
  const operation = state.motionOperation;
  const streamer = state.streamer;
  if (report.state === 'Alarm') {
    set({
      statusReport: report,
      wcoCache: null,
      workOriginActive: false,
      homingState: 'unknown',
      motionOperation: null,
    });
    return;
  }
  const observedOperation = observeMotionStatus(operation, report.state);
  const queuedFrameDispatch =
    operation !== null && observedOperation === null ? takeNextFrameJogLine(operation) : null;
  const nextOperation = queuedFrameDispatch?.operation ?? observedOperation;
  const operationPatch = operation === nextOperation ? {} : { motionOperation: nextOperation };
  const completedStreamerPatch =
    streamer?.status === 'done' && report.state === 'Idle' ? { streamer: null } : {};
  const homingPatch = homingPatchForStatus(state.homingState, report);

  if (report.wco !== null) {
    set({
      statusReport: report,
      wcoCache: report.wco,
      workOriginActive: hasCustomOrigin(report.wco),
      ...operationPatch,
      ...completedStreamerPatch,
      ...homingPatch,
    });
  } else {
    set({ statusReport: report, ...operationPatch, ...completedStreamerPatch, ...homingPatch });
  }
  if (queuedFrameDispatch !== null)
    dispatchQueuedFrameLine(set, safeWrite, queuedFrameDispatch.line);
}

function homingPatchForStatus(
  homingState: LaserState['homingState'],
  report: StatusReport,
): Partial<Pick<LaserState, 'homingState'>> {
  if (report.state === 'Home') return { homingState: 'homing' };
  if (homingState === 'homing' && report.state === 'Idle') return { homingState: 'confirmed' };
  return {};
}

function dispatchQueuedFrameLine(set: SetFn, safeWrite: SafeWriteFn, line: string): void {
  void safeWrite(line, 'frame')
    .then(() => {
      set((s) => ({
        motionOperation: markMotionOperationDispatched(s.motionOperation, 'frame'),
      }));
    })
    .catch(() => {
      set({ motionOperation: null });
    });
}

function advanceStream(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  ack: 'ok' | 'error' | 'alarm',
): void {
  const s: StreamerState | null = get().streamer;
  if (s === null) return;
  const acked = onAck(s, ack);
  const stepped = step(acked.state);
  set({ streamer: stepped.state });
  if (stepped.toSend.length > 0) {
    void safeWrite(stepped.toSend).catch(() => {
      set({
        streamer: markErrored(acked.state),
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
