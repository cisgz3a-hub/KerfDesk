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
  idleCollector,
  markErrored,
  wipeInFlight,
  type StreamerState,
} from '../../core/controllers/grbl';
import { detectControllerFromBanner, type ControllerEvent } from '../../core/controllers';
import { parseActiveWcsFromModalResponses } from '../../core/controllers/grbl/work-offset-readback';
import { flushResetCleanup } from './laser-reset-cleanup';
import {
  qualifiedController,
  qualifyingController,
  scheduleControllerQualification,
} from './laser-controller-qualification';
import { controllerRebootNotice } from './laser-safety-notice';
import {
  clearCncLiveCaps,
  consumeSettingsResponse,
  publishCncLiveCaps,
  SETTINGS_READ_OPERATION_LABEL,
  type DetectedSettingsResult,
} from './detected-settings-action';
import {
  activeControllerCommandLine,
  cancelControllerLifecycleRefs,
  consumeControllerCommandResponse,
  consumeOwnedControllerIdentityResponse,
  observeControllerResetBoundary,
} from './laser-interactive-command';
import { handleErrorLine, handleResendLine } from './laser-error-line';
import { dispatchQueuedMotionLine } from './laser-frame-dispatch';
import {
  acknowledgeMotionSettlementMarker,
  takeNextAcknowledgedFramePrefixLine,
} from './laser-motion-operation';
import type { AckSettlement, GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { forgetAlarmBeforeBanner, takeAlarmBeforeBanner } from './laser-reset-alarm';
import { handleAlarmLine } from './laser-alarm-line';
import { handleStatusLine, originUnknownAfterControllerReset } from './laser-status-line';
import { settleUntrackedAck, streamOwnsTerminalAck } from './laser-stream-ack';
import { flushStreamAcksBefore, routeStreamAck } from './laser-stream-ack-batch';
import type { LaserState } from './laser-store';
import { emptyControllerBuildInfoState } from './laser-controller-build-info';
import { hasUnsettledStreamAcks } from './laser-store-helpers';
import { appendSystemNotice } from './laser-system-notice';
import { inboundTranscriptEntry } from './laser-transcript';
import {
  bufferTranscriptEntry,
  clearTranscriptBuffer,
  publishTranscriptPatch,
} from './laser-transcript-buffer';
import { invalidateSettingsForMpgTakeover } from './laser-settings-mpg-takeover';
import { refreshedReportUnitsPatch, retainControllerReportUnits } from './controller-report-units';

export type { GetFn, HandlerRefs, SetFn } from './laser-line-shared';

export function handleLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  line: string,
): void {
  const cls = refs.driver.classifyLine(line);
  flushStreamAcksBefore(set, get, refs, safeWrite, cls.kind);
  const state = get();
  recordInboundLine(set, refs, state, cls, line);
  captureActiveWcsFromModalReport(set, line);
  invalidateSettingsForMpgTakeover(set, refs, state, cls);
  publishDetectedSettings(set, get, refs, cls);
  // Marlin answers an operator-owned M115 with the same FIRMWARE_NAME line it
  // may emit as a spontaneous startup banner. Let the command owner consume
  // only that expected identity response; an unowned FIRMWARE_NAME or a real
  // `start` banner must still cross the controller-reset boundary below.
  if (consumeOwnedControllerIdentityResponse(refs, cls, line)) return;
  const bannerRaw = bannerCandidateRaw(cls);
  if (bannerRaw !== null) {
    handleWelcomeLine(set, get, refs, safeWrite, bannerRaw);
    return;
  }
  handleNonBannerLine(set, get, refs, safeWrite, cls, line, state);
}

function handleNonBannerLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  cls: ControllerEvent,
  line: string,
  state: LaserState,
): void {
  const ackSettlement = settleUntrackedAck(set, state, cls.kind, refs);
  const ownedCommandLine = activeControllerCommandLine(refs);
  const commandConsumed = consumeControllerCommandResponse(refs, cls, line);
  // An arbiter-owned ALARM still has global machine meaning: invalidate
  // origins, cancel a held stream, and surface the lock. The command promise
  // already rejected above; continue into the shared alarm handler as well.
  if (commandConsumed && !['alarm', 'error', 'resend'].includes(cls.kind)) return;
  if (cls.kind === 'status') {
    // The controller answered after its last ALARM:N, so a later banner is a
    // new boot, not the reset that raised it (laser-reset-alarm.ts).
    forgetAlarmBeforeBanner(refs);
    handleStatusLine(set, get, refs, safeWrite, cls.report);
    return;
  }
  if (cls.kind === 'alarm') {
    handleAlarmLine(set, get, refs, safeWrite, cls.code);
    return;
  }
  if (cls.kind === 'error') {
    handleErrorLine(
      set,
      get,
      refs,
      safeWrite,
      cls.code,
      cls.raw,
      ackSettlement,
      commandConsumed ? ownedCommandLine : undefined,
    );
    return;
  }
  // Marlin "echo:busy:" — the controller is alive but not ready; explicitly
  // NOT an ack, so the streamer must not advance.
  if (cls.kind === 'busy') return;
  if (cls.kind === 'resend') {
    handleResendLine(set, get, refs, safeWrite, cls.line);
    return;
  }
  routeAcknowledgement(set, get, refs, safeWrite, cls.kind, ackSettlement, state.motionOperation);
}

function routeAcknowledgement(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  kind: ControllerEvent['kind'],
  ackSettlement: AckSettlement,
  motionOperationAtIngress: LaserState['motionOperation'],
): void {
  if (kind !== 'ok') return;
  if (ackSettlement.owner === 'untracked') {
    const currentOperation = get().motionOperation;
    const queuedFramePrefix = takeNextAcknowledgedFramePrefixLine(
      motionOperationAtIngress !== null &&
        ackSettlement.motionOperationId === motionOperationAtIngress.operationId &&
        currentOperation?.operationId === motionOperationAtIngress.operationId
        ? currentOperation
        : null,
    );
    if (queuedFramePrefix !== null) {
      set({ motionOperation: queuedFramePrefix.operation });
      dispatchQueuedMotionLine(
        set,
        get,
        safeWrite,
        queuedFramePrefix.line,
        queuedFramePrefix.operation.operationId,
      );
    } else if (ackSettlement.motionOperationId !== null) {
      const motionOperationId = ackSettlement.motionOperationId;
      set((current) => ({
        motionOperation: acknowledgeMotionSettlementMarker(
          current.motionOperation,
          motionOperationId,
          current.statusSequence,
        ),
      }));
    }
  }
  if (ackSettlement.owner === 'stream') routeStreamAck(set, get, refs, safeWrite);
}

// GRBL answers $G with `[GC:...]` (the connect-time modal read, an operator
// console $G, or Work-Z recovery). Surface the active WCS so the placement
// mismatch advisory (C6) sees a G55-G59 frame left active by a $N startup block
// or an external session. Additive: an owned command, if any, still consumes
// the line separately for its own logic; a non-`[GC:]` line parses to null.
function captureActiveWcsFromModalReport(set: SetFn, line: string): void {
  // Runs for every inbound line (incl. the job-stream ok flood); cheap
  // substring reject before the anchored regex keeps the hot path clear.
  if (!line.includes('[GC:')) return;
  const activeWcs = parseActiveWcsFromModalResponses([line]);
  if (activeWcs !== null) set({ activeWcs });
}

function recordInboundLine(
  set: SetFn,
  refs: HandlerRefs,
  state: LaserState,
  cls: ReturnType<HandlerRefs['driver']['classifyLine']>,
  line: string,
): void {
  // A stream-owned `ok` is one of hundreds a second and its own source group is
  // hidden by default, so it is held on the refs and published with the next
  // non-job line or the next job entry after the batch deadline (ADR-333).
  // Everything else publishes immediately, preserving wire order.
  const streamAck = cls.kind === 'ok' && hasUnsettledStreamAcks(state.streamer);
  const buffered = streamAck && streamOwnsTerminalAck(state);
  const entry = inboundTranscriptEntry(
    nextTranscriptId(refs),
    Date.now(),
    line,
    cls,
    refs.driver.kind,
    buffered ? 'job' : 'controller',
  );
  if (buffered) {
    if (bufferTranscriptEntry(refs, entry, line)) set(publishTranscriptPatch(refs, state));
  } else set(publishTranscriptPatch(refs, state, entry, line));
  if (refs.onLineArrived !== null) {
    const cb = refs.onLineArrived;
    refs.onLineArrived = null;
    cb();
  }
}

function publishDetectedSettings(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  cls: ReturnType<HandlerRefs['driver']['classifyLine']>,
): void {
  const state = get();
  const collectionWasActive = refs.settingsCollector.kind === 'collecting';
  const detected = consumeSettingsResponse(refs, cls, state.controllerSessionEpoch);
  const collectionFinished = collectionWasActive && refs.settingsCollector.kind !== 'collecting';
  if (detected === null) {
    if (collectionFinished) {
      set((current) =>
        isSettingsReadOperation(current.controllerOperation) ? { controllerOperation: null } : {},
      );
    }
    return;
  }
  set((current) => ({
    // The terminal $$ acknowledgement is a FIFO boundary: any old-unit
    // status generated before the setting changed has already been received.
    // Discard raw coordinates across this boundary instead of rescaling them
    // using a setting that did not apply when those numbers were reported.
    ...refreshedReportUnitsPatch(current, detected.controllerSettings),
    detectedSettings: shouldShowDetectedSettingsReview(detected) ? detected.patch : null,
    controllerSettings: {
      ...retainControllerReportUnits(current.controllerSettings),
      ...detected.controllerSettings,
    },
    controllerSettingsObservation: {
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: Date.now(),
    },
    controllerQualification: qualifiedController(state.controllerSessionEpoch, 'verified'),
    grblSettingsRows: detected.settingsRows,
    lastSettingsReadAt: Date.now(),
    ...(isSettingsReadOperation(current.controllerOperation) ? { controllerOperation: null } : {}),
  }));
  publishCncLiveCaps(detected.controllerSettings);
}

function isSettingsReadOperation(operation: LaserState['controllerOperation']): boolean {
  return (
    operation?.kind === 'interactive-command' && operation.label === SETTINGS_READ_OPERATION_LABEL
  );
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
  // A "Grbl 1.1f" banner is also grblHAL's at COMPATIBILITY_LEVEL >= 1, so on a
  // grblHAL driver it identifies grblHAL, not a mismatch (audit HF-8).
  const detected = detectControllerFromBanner(raw, refs.driver.kind);
  if (detected === null) return;
  const state = get();
  const nextSessionEpoch = state.controllerSessionEpoch + 1;
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  // The rebooted controller starts a new transcript; anything the old session
  // held back belongs to neither (ADR-333).
  clearTranscriptBuffer(refs);
  refs.settingsCollector = idleCollector();
  refs.settingsCollectorSessionEpoch = null;
  clearCncLiveCaps();
  observeControllerResetBoundary(refs);
  const resetPolicy = controllerResetBoundaryPolicy(state);
  const mismatchLog =
    detected === refs.driver.kind
      ? {}
      : appendSystemNotice(
          state,
          refs,
          `[lf2] Controller banner looks like ${detected}, but the profile selected ${refs.driver.kind}. Check the device profile's controller setting.`,
        );
  // A banner means the controller (re)booted: replies owed by the previous
  // session will never arrive.
  set({
    detectedControllerKind: detected,
    statusReport: null,
    controllerSessionEpoch: nextSessionEpoch,
    statusObservation: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    ...emptyControllerBuildInfoState(),
    controllerQualification: qualifyingController(nextSessionEpoch, 'reset-cleanup'),
    detectedSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    // An ALARM:N the reset itself raised (Abort mid-motion) is still the
    // controller's alarm after the banner; any other code belonged to the
    // previous boot (audit streaming-4).
    alarmCode: takeAlarmBeforeBanner(refs),
    wcoCache: null,
    // A reset re-initializes the parser's modal state ($N runs fresh), so the
    // cached WCS selection is stale until re-qualification re-reads $G (C6).
    activeWcs: null,
    ovCache: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    accessoryCache: null,
    mpgActive: null,
    // Re-prove the rebooted firmware's RX and planner capacities.
    rxCapacityEvidence: null,
    plannerCapacityEvidence: null,
    ...originUnknownAfterControllerReset(state),
    motionOperation: null,
    ...(resetPolicy.preserveOperation ? {} : { controllerOperation: null, probeBusy: false }),
    fireActive: false,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    ...mismatchLog,
    ...rebootDuringJobPatch(state),
  });
  if (!resetPolicy.preserveOperation) {
    cancelControllerLifecycleRefs(refs, resetPolicy.cancellationReason);
  }
  // Beam-off cleanup deferred by a commanded reset (Stop, auto-stop) goes
  // out NOW, after the ledger reset above — its ack is unambiguous (audit
  // F2): the controller is fully booted, so the ok cannot be swallowed and
  // cannot be orphaned by this banner.
  flushResetCleanup(refs, (line, action) => safeWrite(line, action, 'system'));
  scheduleControllerQualification(set, get, refs, nextSessionEpoch);
}

function controllerResetBoundaryPolicy(state: LaserState): {
  readonly preserveOperation: boolean;
  readonly cancellationReason: string;
} {
  const operation = state.controllerOperation;
  const probeRecovering = operation?.kind === 'probe' && operation.phase === 'recovering';
  const probeRebooted = operation?.kind === 'probe' && operation.phase !== 'recovering';
  return {
    preserveOperation:
      probeRecovering ||
      operation?.kind === 'recovery' ||
      operation?.kind === 'connection-handshake',
    cancellationReason: probeRebooted
      ? 'Controller rebooted during the probe transaction.'
      : 'Controller rebooted.',
  };
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
  // 'tool-change' is an active hold with the M0 still queued and pre-M0 motion
  // possibly draining — a reboot there kills the job just like streaming/paused
  // (Codex audit: this status list was not updated when tool-change landed).
  if (streamer === null) return {};
  if (!['idle', 'streaming', 'paused', 'tool-change'].includes(streamer.status)) {
    // A reset banner is a firmware RX-buffer boundary even for an already
    // disconnected stream. Its old in-flight lines can no longer own replies
    // from the new session, including the reconnect settings-query `ok`.
    return streamer.inFlight.length === 0 ? {} : { streamer: wipeInFlight(streamer) };
  }
  return {
    streamer: wipeInFlight(markErrored(streamer)),
    // First notice wins — an earlier root cause is what the operator needs.
    safetyNotice: state.safetyNotice ?? controllerRebootNotice(),
  };
}

function nextTranscriptId(refs: HandlerRefs): number {
  const id = refs.nextTranscriptId ?? 1;
  refs.nextTranscriptId = id + 1;
  return id;
}
