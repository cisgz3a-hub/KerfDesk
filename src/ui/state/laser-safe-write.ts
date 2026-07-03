import type { ControllerDriver } from '../../core/controllers';
import type { SerialConnection } from '../../platform/types';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import {
  appendTranscript,
  outboundTranscriptEntry,
  type TranscriptSource,
} from './laser-transcript';
import type { LaserState } from './laser-store';
import {
  activeJobCommandBlockMessage,
  pushLog,
  serialWriteErrorMessage,
} from './laser-store-helpers';

export type SafeWriteRefs = {
  readonly connection: SerialConnection | null;
  readonly driver: ControllerDriver;
  nextTranscriptId: number;
};

export type SafeWrite = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

export function createSafeWrite(set: SetFn, get: GetFn, refs: SafeWriteRefs): SafeWrite {
  return async (line, action, source) => {
    // Setup-only lines (GRBL `$` commands) are blocked while a job is active;
    // the active driver decides what counts as setup-only for its firmware.
    const blockedMessage = refs.driver.isSetupOnlyPayload(line)
      ? activeJobCommandBlockMessage(get())
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
    try {
      const writeSource =
        source ?? transcriptSourceForWrite(line, action, refs.driver.realtime.statusQuery);
      await conn.write(line);
      set((s) => ({
        transcript: appendTranscript(
          s.transcript,
          outboundTranscriptEntry(refs.nextTranscriptId++, Date.now(), line, writeSource),
        ),
        ...(owesTerminalAck(line, writeSource)
          ? { pendingUntrackedAcks: s.pendingUntrackedAcks + 1 }
          : {}),
      }));
    } catch (err) {
      const message = serialWriteErrorMessage(err);
      set({
        lastWriteError: message,
        log: pushLog(
          get(),
          `[lf2] Serial write failed: ${message}. Machine may not have received the command.`,
        ),
        ...(action === undefined ? {} : { safetyNotice: writeFailedNotice(action) }),
      });
      console.error('Serial write failed:', err);
      throw err instanceof Error ? err : new Error(message);
    }
  };
}

// Every queued (newline-terminated) write earns exactly one terminal
// ok/error from the controller, in strict receive order. Job-stream chunks
// are excluded: their acks belong to the streamer's RX accounting. Realtime
// bytes (?, !, ~, 0x18, 0x85, overrides) have no newline and no ack. The
// line handler settles the counter when the terminal ack arrives, and Start
// gates on it reaching zero.
function owesTerminalAck(line: string, source: TranscriptSource): boolean {
  return line.endsWith('\n') && source !== 'job';
}

function transcriptSourceForWrite(
  line: string,
  action: LaserSafetyAction | undefined,
  statusQuery: string | null,
): TranscriptSource {
  if (statusQuery !== null && line === statusQuery) return 'poll';
  if (action === 'start' || action === 'resume') return 'job';
  if (action === 'frame' || action === 'jog' || action === 'home') return 'motion';
  if (action === 'origin') return 'origin';
  if (action === 'wake') return 'system';
  if (action === 'unlock' || action === 'console') return 'console';
  return 'system';
}
