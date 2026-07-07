// Line-receive pipeline entry point. handleLine classifies an inbound
// controller line, records it, settles the untracked-ack ledger, and fans
// the result out to the sibling modules:
//
//   laser-status-line — status reports (<...|...>) into LaserState
//   laser-error-line  — error:N / Resend rejections
//   laser-stream-ack  — ack attribution + the streamer's ack loop
//
// This module keeps the classification fan-out plus the banner and ALARM:N
// line handlers. All handlers take the shared mutable `refs` object by
// reference (same instance laser-store creates) so the settings-collector
// state is observable across calls.

import {
  markErrored,
  wipeInFlight,
  type GrblPins,
  type StreamerState,
} from '../../core/controllers/grbl';
import { detectControllerFromBanner } from '../../core/controllers';
import { flushResetCleanup } from './laser-reset-cleanup';
import { controllerRebootNotice } from './laser-safety-notice';
import { consumeSettingsResponse, type DetectedSettingsResult } from './detected-settings-action';
import {
  cancelControllerLifecycleRefs,
  consumeControllerCommandResponse,
} from './laser-interactive-command';
import { handleErrorLine, handleResendLine } from './laser-error-line';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { frameHitLimitNotice } from './laser-safety-notice';
import { handleStatusLine, originUnknownAfterControllerReset } from './laser-status-line';
import { advanceStream, settleUntrackedAck } from './laser-stream-ack';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { appendTranscript, inboundTranscriptEntry } from './laser-transcript';

export type { GetFn, HandlerRefs, SetFn } from './laser-line-shared';

export function handleLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  line: string,
): void {
  const cls = refs.driver.classifyLine(line);
  const state = get();
  recordInboundLine(set, refs, state, cls, line);
  publishDetectedSettings(set, refs, cls);
  const ackOwner = settleUntrackedAck(set, state, cls.kind);
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
    handleErrorLine(set, get, refs, safeWrite, cls.code, cls.raw, ackOwner);
    return;
  }
  const bannerRaw = bannerCandidateRaw(cls);
  if (bannerRaw !== null) {
    handleWelcomeLine(set, get, refs, safeWrite, bannerRaw);
    return;
  }
  // Marlin "echo:busy:" — the controller is alive but not ready; explicitly
  // NOT an ack, so the streamer must not advance.
  if (cls.kind === 'busy') return;
  if (cls.kind === 'resend') {
    handleResendLine(set, get, refs, safeWrite, cls.line);
    return;
  }
  if (cls.kind === 'ok' && ackOwner === 'stream') {
    advanceStream(set, get, refs, safeWrite, 'ok');
  }
}

function recordInboundLine(
  set: SetFn,
  refs: HandlerRefs,
  state: LaserState,
  cls: ReturnType<HandlerRefs['driver']['classifyLine']>,
  line: string,
): void {
  set({
    log: pushLog(state, line),
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
}

function publishDetectedSettings(
  set: SetFn,
  refs: HandlerRefs,
  cls: ReturnType<HandlerRefs['driver']['classifyLine']>,
): void {
  const detected = consumeSettingsResponse(refs, cls);
  if (detected === null) return;
  set({
    detectedSettings: shouldShowDetectedSettingsReview(detected) ? detected.patch : null,
    controllerSettings: detected.controllerSettings,
    grblSettingsRows: detected.settingsRows,
    lastSettingsReadAt: Date.now(),
  });
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
function handleWelcomeLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  raw: string,
): void {
  const detected = detectControllerFromBanner(raw);
  if (detected === null) return;
  const state = get();
  const mismatchLog =
    detected === refs.driver.kind
      ? {}
      : {
          log: pushLog(
            state,
            `[lf2] Controller banner looks like ${detected}, but the profile selected ${refs.driver.kind}. Check the device profile's controller setting.`,
          ),
        };
  // A banner means the controller (re)booted: replies owed by the previous
  // session will never arrive.
  set({
    detectedControllerKind: detected,
    pendingUntrackedAcks: 0,
    ...mismatchLog,
    ...rebootDuringJobPatch(state),
  });
  // Beam-off cleanup deferred by a commanded reset (Stop, auto-stop) goes
  // out NOW, after the ledger reset above — its ack is unambiguous (audit
  // F2): the controller is fully booted, so the ok cannot be swallowed and
  // cannot be orphaned by this banner.
  flushResetCleanup(refs, (line, action) => safeWrite(line, action, 'system'));
}

// A banner while the stream is still live can only be an UNCOMMANDED reboot
// (watchdog reset, power blip): every commanded reset — Stop, wake, the
// auto-stop after a stream error — cancels or errors the streamer BEFORE its
// banner can arrive. The reboot discarded all buffered motion, so the job is
// over: without this the UI showed a live progress bar until the generic
// stall watchdog fired 10–90 s later (audit F2). 'errored' keeps Stop and
// recovery mounted; the wiped in-flight lines will never be acked.
function rebootDuringJobPatch(
  state: LaserState,
): Partial<Pick<LaserState, 'streamer' | 'safetyNotice'>> {
  const streamer: StreamerState | null = state.streamer;
  if (streamer === null || !['idle', 'streaming', 'paused'].includes(streamer.status)) return {};
  return {
    streamer: wipeInFlight(markErrored(streamer)),
    // First notice wins — an earlier root cause is what the operator needs.
    safetyNotice: state.safetyNotice ?? controllerRebootNotice(),
  };
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
    // The alarmed controller discards its pending work; owed acks are gone.
    pendingUntrackedAcks: 0,
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
