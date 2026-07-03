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
  disconnect as disconnectStreamer,
  type GrblPins,
  onAck,
  type SettingsCollectorState,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { detectControllerFromBanner, type ControllerDriver } from '../../core/controllers';
import { consumeSettingsResponse, type DetectedSettingsResult } from './detected-settings-action';
import {
  cancelControllerLifecycleRefs,
  consumeControllerCommandResponse,
  observeControllerIdleWait,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { beginPostJobSettle } from './laser-post-job-settle';
import {
  controllerErrorNotice,
  disconnectDuringJobNotice,
  frameHitLimitNotice,
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
import type { TranscriptSource } from './laser-transcript';
import { hasCustomOrigin } from './origin-actions';

export type HandlerRefs = ControllerLifecycleRefs & {
  // Active firmware driver — classification and follow-up command bytes come
  // from here so this pipeline stays firmware-neutral (ADR-094).
  driver: ControllerDriver;
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
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const LOG_MAX = 200;

function appendLog(state: LaserState, line: string): ReadonlyArray<string> {
  return [...state.log, line].slice(-LOG_MAX);
}

function shouldShowDetectedSettingsReview(detected: DetectedSettingsResult): boolean {
  if (Object.keys(detected.patch).length > 0) return true;
  const controller = detected.controllerSettings;
  if (
    controller.softLimitsEnabled !== undefined ||
    controller.hardLimitsEnabled !== undefined ||
    controller.homingEnabled !== undefined ||
    controller.homingDirectionMask !== undefined
  ) {
    return true;
  }
  if (isPositive(controller.zMaxFeed) && isPositive(controller.zTravelMm)) return true;
  return detected.settingsRows.some((row) => !row.known);
}

function isPositive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function handleLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  line: string,
): void {
  const cls = refs.driver.classifyLine(line);
  const state = get();
  set({
    log: appendLog(state, line),
    transcript: appendTranscript(
      state.transcript,
      inboundTranscriptEntry(nextTranscriptId(refs), Date.now(), line, cls),
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
      detectedSettings: shouldShowDetectedSettingsReview(detected) ? detected.patch : null,
      controllerSettings: detected.controllerSettings,
      grblSettingsRows: detected.settingsRows,
      lastSettingsReadAt: Date.now(),
    });
  }
  if (consumeControllerCommandResponse(refs, cls, line)) return;
  if (cls.kind === 'status') {
    handleStatusLine(set, get, refs, safeWrite, cls.report);
    return;
  }
  if (cls.kind === 'alarm') {
    handleAlarmLine(set, get, refs, safeWrite, cls.code);
    return;
  }
  if (cls.kind === 'error') {
    handleErrorLine(set, get, refs, safeWrite, cls.code, cls.raw);
    return;
  }
  const bannerRaw = bannerCandidateRaw(cls);
  if (bannerRaw !== null) {
    handleWelcomeLine(set, get, refs, bannerRaw);
    return;
  }
  // Marlin "echo:busy:" — the controller is alive but not ready; explicitly
  // NOT an ack, so the streamer must not advance.
  if (cls.kind === 'busy') return;
  if (cls.kind === 'resend') {
    handleResendLine(set, get, refs, safeWrite, cls.line);
    return;
  }
  if (cls.kind === 'ok') {
    advanceStream(set, get, refs, safeWrite, 'ok');
  }
}

// Unknown lines run through banner detection too: connecting with the wrong
// driver selected (e.g. GRBL driver hearing Marlin's `start`) classifies the
// foreign banner as unknown, and the advisory is exactly what the operator
// needs to fix the profile.
function bannerCandidateRaw(cls: { readonly kind: string; readonly raw?: string }): string | null {
  if (cls.kind !== 'welcome' && cls.kind !== 'unknown') return null;
  return cls.raw ?? null;
}

// Welcome banners carry the firmware identity. Record what was detected and
// warn (log-only) when it disagrees with the profile-selected driver — GRBL
// family members are wire-compatible, so this is advisory, not a refusal.
function handleWelcomeLine(set: SetFn, get: GetFn, refs: HandlerRefs, raw: string): void {
  const detected = detectControllerFromBanner(raw);
  if (detected === null) return;
  const mismatchLog =
    detected === refs.driver.kind
      ? {}
      : {
          log: appendLog(
            get(),
            `[lf2] Controller banner looks like ${detected}, but the profile selected ${refs.driver.kind}. Check the device profile's controller setting.`,
          ),
        };
  set({ detectedControllerKind: detected, ...mismatchLog });
}

function handleErrorLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  code: number | null,
  raw: string | undefined,
): void {
  const state = get();
  const rejectedLine = state.streamer?.inFlight[0]?.line.trim();
  const motionErrorPatch =
    state.motionOperation !== null ? { motionOperation: null, frameVerification: null } : {};
  set({
    lastError: code,
    safetyNotice: controllerErrorNotice(code, controllerErrorContext(state), raw, rejectedLine),
    ...motionErrorPatch,
  });
  requestRealtimeStopAfterStreamError(state.streamer, refs.driver, safeWrite);
  advanceStream(set, get, refs, safeWrite, 'error');
}

// Checksum-mode retransmission is not implemented (ADR-094 v1): the sender
// and firmware are desynced, so a Resend is a fatal stream error rather than
// a replay — replaying motion lines out of order could move a live laser.
function handleResendLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  requestedLine: number,
): void {
  const current = get();
  set({
    safetyNotice: controllerErrorNotice(
      null,
      controllerErrorContext(current),
      `Resend:${requestedLine} — line-number retransmission is not supported`,
    ),
  });
  requestRealtimeStopAfterStreamError(current.streamer, refs.driver, safeWrite);
  advanceStream(set, get, refs, safeWrite, 'error');
}

// GRBL ALARM:1 — hard limit triggered (see alarm-codes.ts).
const HARD_LIMIT_ALARM_CODE = 1;

function handleAlarmLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  code: number,
): void {
  // A hard-limit alarm that fires while a Verified Frame is tracing means the
  // job box runs past the travel from this origin — name the limit so the
  // operator knows which way to move (ADR-053 P3). The alarm also clears the
  // origin + frame verification.
  const prev = get();
  const frameLimitPatch =
    prev.motionOperation?.kind === 'frame' && code === HARD_LIMIT_ALARM_CODE
      ? { safetyNotice: frameHitLimitNotice(activeLimitAxisLabel(prev.statusReport?.pins ?? null)) }
      : {};
  set({
    alarmCode: code,
    wcoCache: null,
    ...originUnknownAfterControllerReset(prev),
    motionOperation: null,
    controllerOperation: null,
    frameVerification: null,
    ...frameLimitPatch,
  });
  cancelControllerLifecycleRefs(refs, `ALARM:${code}`);
  advanceStream(set, get, refs, safeWrite, 'alarm');
}

function activeLimitAxisLabel(pins: GrblPins | null): string | null {
  if (pins === null) return null;
  const axes: string[] = [];
  if (pins.limitX) axes.push('X');
  if (pins.limitY) axes.push('Y');
  if (pins.limitZ) axes.push('Z');
  return axes.length > 0 ? axes.join('/') : null;
}

function nextTranscriptId(refs: HandlerRefs): number {
  const id = refs.nextTranscriptId ?? 1;
  refs.nextTranscriptId = id + 1;
  return id;
}

function handleStatusLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
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
      ovCache: null,
      ...originUnknownAfterControllerReset(get()),
      motionOperation: null,
      controllerOperation: null,
      frameVerification: null,
      homingState: 'unknown',
    });
    cancelControllerLifecycleRefs(refs, 'Controller entered Alarm.');
    return;
  }
  if (report.state === 'Sleep') {
    set({
      statusReport: report,
      alarmCode: null,
      wcoCache: null,
      ovCache: null,
      ...originUnknownAfterControllerReset(get()),
      motionOperation: null,
      controllerOperation: null,
      frameVerification: null,
      homingState: 'unknown',
    });
    cancelControllerLifecycleRefs(refs, 'Controller entered Sleep.');
    return;
  }
  const observedOperation = observeMotionStatus(operation, report.state);
  const queuedFrameDispatch =
    operation !== null && observedOperation === null ? takeNextFrameJogLine(operation) : null;
  const nextOperation = queuedFrameDispatch?.operation ?? observedOperation;
  const operationPatch = operation === nextOperation ? {} : { motionOperation: nextOperation };
  // Release the job lock once GRBL settles to Idle for BOTH a clean finish
  // ('done') and a rejected line ('errored'). Idle means physical motion has
  // stopped, so it is as safe to clear here as the 'done' case. Without the
  // 'errored' arm a GRBL error:N left the streamer terminal-but-non-null
  // forever, so isActiveJob stayed true and every setup/jog/console command —
  // plus the clear-canvas guard — was blocked until a reconnect. The
  // controller-error safetyNotice lives in separate state and survives.
  const jobOverAtIdle = shouldReleaseStreamerAtIdle(streamer, report);
  const completedStreamerPatch = jobOverAtIdle ? { streamer: null } : {};

  set({
    ...statusPositionPatch(report, state.workOriginSource),
    ...operationPatch,
    ...completedStreamerPatch,
  });
  observeControllerIdleWait(set, refs, report);
  if (queuedFrameDispatch !== null)
    dispatchQueuedFrameLine(set, safeWrite, queuedFrameDispatch.line);
}

function shouldReleaseStreamerAtIdle(
  streamer: StreamerState | null,
  report: StatusReport,
): boolean {
  return streamer !== null && streamer.status === 'errored' && report.state === 'Idle';
}

function requestRealtimeStopAfterStreamError(
  streamer: StreamerState | null,
  driver: ControllerDriver,
  safeWrite: SafeWriteFn,
): void {
  const streamCanStillHaveBufferedMotion =
    streamer !== null && ['streaming', 'paused', 'done'].includes(streamer.status);
  if (!streamCanStillHaveBufferedMotion) return;
  const softReset = driver.realtime.softReset;
  const abort = softReset === null ? Promise.resolve() : safeWrite(softReset, 'stop', 'system');
  void abort
    .then(async () => {
      for (const line of driver.commands.stopLaserLines) {
        await safeWrite(`${line}\n`, 'stop', 'system');
      }
    })
    .catch(() => undefined);
}

function statusPositionPatch(
  report: StatusReport,
  originSource: LaserState['workOriginSource'],
): Pick<LaserState, 'statusReport'> &
  Partial<Pick<LaserState, 'wcoCache' | 'ovCache' | 'workOriginActive' | 'workOriginSource'>> {
  // Ov: is reported on the same intermittent cadence as WCO — cache the
  // last-seen values so the overrides readout doesn't flicker (ADR-103 G3).
  const ovPatch = report.ov === null || report.ov === undefined ? {} : { ovCache: report.ov };
  if (report.wco === null) return { statusReport: report, ...ovPatch };
  const active = hasCustomOrigin(report.wco);
  return {
    statusReport: report,
    ...ovPatch,
    wcoCache: report.wco,
    workOriginActive: active,
    workOriginSource: active ? knownOrUnknownOriginSource(originSource) : 'none',
  };
}

function knownOrUnknownOriginSource(
  source: LaserState['workOriginSource'],
): LaserState['workOriginSource'] {
  return source === 'none' ? 'unknown' : source;
}

function originUnknownAfterControllerReset(
  state: LaserState,
): Pick<LaserState, 'workOriginActive' | 'workOriginSource'> {
  if (state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown') {
    return { workOriginActive: true, workOriginSource: 'unknown' };
  }
  return { workOriginActive: false, workOriginSource: 'none' };
}

function dispatchQueuedFrameLine(set: SetFn, safeWrite: SafeWriteFn, line: string): void {
  void safeWrite(line, 'frame')
    .then(() => {
      set((s) => ({
        motionOperation: markMotionOperationDispatched(s.motionOperation, 'frame'),
      }));
    })
    .catch(() => {
      set({ motionOperation: null, frameVerification: null });
    });
}

function advanceStream(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  ack: 'ok' | 'error' | 'alarm',
): void {
  const s: StreamerState | null = get().streamer;
  if (s === null) return;
  const acked = onAck(s, ack);
  const stepped = step(acked.state);
  set({ streamer: stepped.state });
  if (s.status !== 'done' && stepped.state.status === 'done') {
    beginPostJobSettle(set, get, refs, safeWrite);
  }
  if (stepped.toSend.length > 0) {
    void safeWrite(stepped.toSend).catch(() => {
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
