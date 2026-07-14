// laser-error-line — handles controller rejection lines (error:N / Resend)
// for the job stream. Split from laser-line-handler when the untracked-ack
// attribution pushed that file past the 400-line cap.

import { wipeInFlight, type StreamerState } from '../../core/controllers/grbl';
import { armResetCleanup } from './laser-reset-cleanup';
import { controllerErrorNotice, type ControllerErrorContext } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { advanceStream } from './laser-stream-ack';
import type { AckOwner, GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';

export function handleErrorLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  code: number | null,
  raw: string | undefined,
  ackOwner: AckOwner,
): void {
  const state = get();
  // An error owed to an untracked write (console typo, rejected origin
  // command) is not a stream event: surface it, but leave the streamer's
  // accounting and the auto-stop path alone.
  const rejectedLine = ackOwner === 'stream' ? state.streamer?.inFlight[0]?.line.trim() : undefined;
  const motionErrorPatch =
    state.motionOperation !== null ? { motionOperation: null, frameVerification: null } : {};
  set({
    lastError: code,
    ...errorNoticePatch(state, code, raw, rejectedLine),
    ...motionErrorPatch,
  });
  if (ackOwner === 'untracked') return;
  requestRealtimeStopAfterStreamError(set, refs, state.streamer, safeWrite);
  advanceStream(set, get, refs, safeWrite, 'error');
}

// Checksum-mode retransmission is not implemented (ADR-094 v1): the sender
// and firmware are desynced, so a Resend is a fatal stream error rather than
// a replay — replaying motion lines out of order could move a live laser.
export function handleResendLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  requestedLine: number,
): void {
  const current = get();
  set(
    errorNoticePatch(
      current,
      null,
      `Resend:${requestedLine} — line-number retransmission is not supported`,
      undefined,
    ),
  );
  requestRealtimeStopAfterStreamError(set, refs, current.streamer, safeWrite);
  advanceStream(set, get, refs, safeWrite, 'error');
}

// Abort (user or auto-abort-after-error) sends realtime reset plus a queued
// beam-off line; the locked controller bounces that line with error:9. Those
// echoes of a shutdown the app itself requested must not raise a fresh "the
// laser may have fired out of place" banner — on a stream that is already
// terminal the error is expected, and an existing notice is the root cause
// the operator still needs to read (first notice wins, as in the settle
// failure path).
function errorNoticePatch(
  state: LaserState,
  code: number | null,
  raw: string | undefined,
  rejectedLine: string | undefined,
): Partial<Pick<LaserState, 'safetyNotice'>> {
  if (isStoppedStreamErrorEcho(state.streamer)) return {};
  return {
    safetyNotice:
      state.safetyNotice ??
      controllerErrorNotice(code, controllerErrorContext(state), raw, rejectedLine),
  };
}

function isStoppedStreamErrorEcho(streamer: StreamerState | null): boolean {
  return streamer !== null && ['cancelled', 'errored', 'disconnected'].includes(streamer.status);
}

function requestRealtimeStopAfterStreamError(
  set: SetFn,
  refs: HandlerRefs,
  streamer: StreamerState | null,
  safeWrite: SafeWriteFn,
): void {
  const streamCanStillHaveBufferedMotion =
    streamer !== null && ['streaming', 'paused', 'done', 'tool-change'].includes(streamer.status);
  if (!streamCanStillHaveBufferedMotion) return;
  const driver = refs.driver;
  const softReset = driver.realtime.softReset;
  if (softReset === null) {
    // No reset byte (Marlin): the RX buffer was not wiped, so beam-off goes
    // out immediately and its acks queue behind the in-flight job lines.
    void (async () => {
      for (const line of driver.commands.stopLaserLines) {
        await safeWrite(`${line}\n`, 'stop', 'system');
      }
    })().catch(() => undefined);
    return;
  }
  set((state) => invalidateControllerSessionEvidence(state));
  void safeWrite(softReset, 'stop', 'system')
    .then(() => {
      // The sent reset wiped the firmware's RX buffer: the errored stream's
      // remaining in-flight lines will never be acked, so drop them or the
      // cleanup acks get claimed by the dead stream (audit F1). Status stays
      // 'errored' — Abort remains mounted. The beam-off cleanup itself is
      // deferred until the boot banner (audit F2), like stopJob's.
      set((s) => ({ streamer: s.streamer === null ? null : wipeInFlight(s.streamer) }));
      armResetCleanup(refs, (line, action) => safeWrite(line, action, 'system'), [
        ...driver.commands.stopLaserLines,
      ]);
    })
    .catch(() => undefined);
}

function controllerErrorContext(state: LaserState): ControllerErrorContext {
  if (state.streamer !== null) return 'job';
  if (state.motionOperation?.kind === 'frame') return 'frame';
  if (state.motionOperation?.kind === 'jog') return 'jog';
  return 'command';
}
