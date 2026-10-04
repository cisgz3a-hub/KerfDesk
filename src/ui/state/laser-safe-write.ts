import {
  reserveWrite,
  assertDispatchWrite,
  motionTransportWritePatch,
} from './laser-write-reservation';
import type { ControllerDriver } from '../../core/controllers';
import { wireEncodingError } from '../../core/controllers/serial-wire-encoding';
import type { SerialConnection } from '../../platform/types';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import { outboundTranscriptEntry, type TranscriptSource } from './laser-transcript';
import {
  bufferTranscriptEntry,
  publishTranscriptPatch,
  type TranscriptBufferRefs,
} from './laser-transcript-buffer';
import type { LaserState } from './laser-store';
import type { LaserMotionOperationId } from './laser-motion-operation';
import { JOG_MPG_INTERRUPTION_MESSAGE } from './frame-status-failure';
import type { UntrackedAckLedgerRefs } from './laser-untracked-ack-ledger';
import {
  beginJobTransportWrite,
  settleJobTransportWrite,
  type JobTransportLedgerRefs,
} from './laser-job-transport-ledger';
import {
  activeJobCommandBlockMessage,
  pushLog,
  serialWriteErrorMessage,
  setupBlockingJobCommandBlockMessage,
} from './laser-store-helpers';
import { isProbeAlarmedToolChangeHold } from './tool-change-probe-alarm';
import { framePushWritePatch } from './laser-frame-modal-restore';
import { toolOffAirPatch } from './laser-tool-off-air';

export type SafeWriteRefs = UntrackedAckLedgerRefs &
  TranscriptBufferRefs &
  JobTransportLedgerRefs & {
    connection: SerialConnection | null;
    readonly driver: ControllerDriver;
    nextTranscriptId: number;
    writeEpoch?: number;
  };

// Advisory queries ($G and friends) are ordinary owed-ack lines: every
// newline-terminated write owes exactly one terminal ok on the untracked-ack
// fence, and the line handler settles it like any other. An "ackless" mode
// (reserve no ack, consume the ok passively) shipped with the C6 connect read
// but was inert in production — the store's 3-arg wrappers silently dropped
// the option — and its unaccounted ok carried an F1 mis-settle risk the owed
// path cannot have. Removed deliberately; do not reintroduce (rolling audit
// 2026-07-17-0146 addendum P3-4, maintainer decision "fix all").
export type SafeWrite = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
  assertBeforeWrite?: () => void,
) => Promise<void>;

const MOTION_TRANSCRIPT_ACTIONS: ReadonlyArray<LaserSafetyAction | undefined> = [
  'frame',
  'jog',
  'home',
  'probe',
  'autofocus',
];

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

export function createSafeWrite(set: SetFn, get: GetFn, refs: SafeWriteRefs): SafeWrite {
  return async (line, action, source, assertBeforeWrite) => {
    assertBeforeWrite?.();
    // Setup-only lines (GRBL `$` commands) are blocked while a job is active;
    // the active driver decides what counts as setup-only for its firmware.
    const blockedMessage = refs.driver.isSetupOnlyPayload(line)
      ? setupPayloadBlockMessage(get(), action)
      : null;
    if (blockedMessage !== null) {
      set({
        lastWriteError: blockedMessage,
        log: pushLog(get(), `[lf2] Serial write blocked: ${blockedMessage}`),
      });
      throw new Error(blockedMessage);
    }
    const conn = refs.connection;
    if (conn === null) {
      const message = 'No active serial connection.';
      set({
        lastWriteError: message,
        log: pushLog(
          get(),
          `[lf2] Serial write failed: ${message}. Machine may not have received the command.`,
        ),
        ...(action === undefined ? {} : { safetyNotice: writeFailedNotice(action) }),
      });
      throw new Error(message);
    }
    const writeSource =
      source ?? transcriptSourceForWrite(line, action, refs.driver.realtime.statusQuery);
    if (source === 'job' && action === undefined) return writeJobRefill(set, refs, conn, line);
    refuseUnencodableLine(set, get, line);
    const binding = reserveWrite(set, get, refs, line, action, writeSource);
    const { writeEpoch, ownedMotionOperationId } = binding;
    assertDispatchWrite(set, refs, conn, action, binding, assertBeforeWrite);
    try {
      await conn.write(line);
      assertCurrentWriteEpoch(refs, writeEpoch);
      commitSuccessfulWrite(set, refs, line, writeSource, action, ownedMotionOperationId);
    } catch (err) {
      recordWriteFailure(set, refs, writeEpoch, err, action, ownedMotionOperationId);
      throw err instanceof Error ? err : new Error(serialWriteErrorMessage(err));
    }
  };
}
// A job makes `$` lines off limits, with two exceptions inside a tool-change
// hold. The operator's jog in a drained, fresh-Idle hold: GRBL's native jog is
// itself a `$J=` line (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging),
// the M0 is held host-side so the controller really is Idle and accepts it,
// and runJog has already admitted the move through this same setup-motion
// gate. Before, the strict gate refused that jog here, so the touch-off the
// hold asks for was impossible without aborting (audit drivers-2). And the
// `$X` that unlocks a hold a missed touch-off probe stopped, which the hold
// survives (audit streaming-3). Every other action keeps the strict gate:
// Frame, Home, `$$` and setting writes stay refused for the whole job, and
// Start never unblocks at a tool change.
function setupPayloadBlockMessage(
  state: LaserState,
  action: LaserSafetyAction | undefined,
): string | null {
  if (action === 'jog') return setupBlockingJobCommandBlockMessage(state);
  if (action === 'unlock' && isProbeAlarmedToolChangeHold(state)) return null;
  return activeJobCommandBlockMessage(state);
}

// A line the wire cannot carry is refused before anything is reserved for it.
// The transport would reject it before a single byte left the host, so no
// acknowledgement can ever answer it and nothing reached the machine: record
// the refusal, owe nothing, and raise no E-stop notice. The quarantine in
// recordWriteFailure stays for failures that really are ambiguous (audit
// transport-1).
function refuseUnencodableLine(set: SetFn, get: GetFn, line: string): void {
  const refusal = wireEncodingError(line);
  if (refusal === null) return;
  set({
    lastWriteError: refusal.message,
    log: pushLog(get(), `[lf2] Serial write refused before sending: ${refusal.message}`),
  });
  throw refusal;
}

// A refill (one per acknowledged line) owes no untracked ack and belongs to no
// motion operation, so its only store-visible bookkeeping was the transport
// counter, which now lives on the job transport ledger (ADR-352). Its
// transcript entry is held back with the acknowledgement it answers
// (ADR-333), so an ordinary refill performs no store write at all. A failure
// is recorded exactly as before, minus the store counter it never took.
async function writeJobRefill(
  set: SetFn,
  refs: SafeWriteRefs,
  conn: SerialConnection,
  line: string,
): Promise<void> {
  const writeEpoch = refs.writeEpoch ?? 0;
  const ledgerEpoch = beginJobTransportWrite(refs);
  try {
    await conn.write(line);
    assertCurrentWriteEpoch(refs, writeEpoch);
  } catch (err) {
    settleJobTransportWrite(refs, ledgerEpoch);
    recordWriteFailure(set, refs, writeEpoch, err, undefined, undefined, false);
    throw err instanceof Error ? err : new Error(serialWriteErrorMessage(err));
  }
  settleJobTransportWrite(refs, ledgerEpoch);
  const entry = outboundTranscriptEntry(refs.nextTranscriptId++, Date.now(), line, 'job');
  if (bufferTranscriptEntry(refs, entry)) {
    set((state) => publishTranscriptPatch(refs, state));
  }
}

function assertCurrentWriteEpoch(refs: SafeWriteRefs, expected: number): void {
  if ((refs.writeEpoch ?? 0) === expected) return;
  throw new Error('Serial session changed before the write completed. Command result is invalid.');
}

function commitSuccessfulWrite(
  set: SetFn,
  refs: SafeWriteRefs,
  line: string,
  source: TranscriptSource,
  action: LaserSafetyAction | undefined,
  motionOperationId: LaserMotionOperationId | undefined,
): void {
  const entry = outboundTranscriptEntry(refs.nextTranscriptId++, Date.now(), line, source);
  // A job-stream chunk (the Start window, a Resume refill) is the other half
  // of the acknowledgement flood, so it is held back the same way and
  // published with the next line that matters (ADR-333). Ordinary refills
  // never reach here; they take writeJobRefill.
  const publishJobBatch = source === 'job' && bufferTranscriptEntry(refs, entry);
  set((state) => ({
    pendingTransportWrites: Math.max(0, (state.pendingTransportWrites ?? 0) - 1),
    ...motionTransportWritePatch(state, action, -1, motionOperationId),
    ...framePushWritePatch(state, refs.driver, line, action),
    ...toolOffAirPatch(line, action),
    ...(source === 'job'
      ? publishJobBatch
        ? publishTranscriptPatch(refs, state)
        : {}
      : publishTranscriptPatch(refs, state, entry)),
  }));
}

function recordWriteFailure(
  set: SetFn,
  refs: SafeWriteRefs,
  expectedEpoch: number,
  err: unknown,
  action: LaserSafetyAction | undefined,
  motionOperationId: LaserMotionOperationId | undefined,
  storeCounted = true,
): void {
  if ((refs.writeEpoch ?? 0) !== expectedEpoch) return;
  const message = serialWriteErrorMessage(err);
  set((state) => ({
    ...(storeCounted
      ? { pendingTransportWrites: Math.max(0, (state.pendingTransportWrites ?? 0) - 1) }
      : {}),
    // A queued-write rejection is ambiguous: the controller may have accepted
    // the line before the adapter failed. Retain its FIFO acknowledgement
    // reservation as a quarantine until the real terminal response arrives or
    // a reconnect advances the write epoch.
    ...motionTransportWritePatch(state, action, -1, motionOperationId),
    lastWriteError:
      state.motionOperation?.operationId === motionOperationId &&
      state.motionOperation?.mpgInterruptionId !== undefined
        ? `${message}. ${JOG_MPG_INTERRUPTION_MESSAGE}`
        : message,
    log: pushLog(
      state,
      `[lf2] Serial write failed: ${message}. Machine may not have received the command.`,
    ),
    ...(action === undefined ? {} : { safetyNotice: writeFailedNotice(action) }),
  }));
  console.error('Serial write failed:', err);
}

// Every queued (newline-terminated) LINE earns exactly one terminal
// ok/error from the controller, in strict receive order — and one write may
// carry several lines (the Marlin/Smoothie jog payload is G91\nG0…\nG90\n,
// three acks; audit F3). Count newlines, not writes. Job-stream chunks are
// excluded: their acks belong to the streamer's RX accounting. Realtime
// bytes (?, !, ~, 0x18, 0x85, overrides) have no newline and no ack. The
// line handler settles the counter as each terminal ack arrives, and Start
// gates on it reaching zero.
function transcriptSourceForWrite(
  line: string,
  action: LaserSafetyAction | undefined,
  statusQuery: string | null,
): TranscriptSource {
  if (statusQuery !== null && line === statusQuery) return 'poll';
  if (action === 'start' || action === 'resume') return 'job';
  if (MOTION_TRANSCRIPT_ACTIONS.includes(action)) return 'motion';
  if (action === 'origin') return 'origin';
  if (action === 'wake') return 'system';
  if (action === 'unlock' || action === 'console') return 'console';
  return 'system';
}
