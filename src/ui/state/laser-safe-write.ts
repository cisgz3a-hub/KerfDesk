import { RT_STATUS } from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import {
  appendTranscript,
  outboundTranscriptEntry,
  type TranscriptSource,
} from './laser-transcript';
import type { LaserState } from './laser-store';
import {
  idleOnlyDollarCommandBlockMessage,
  pushLog,
  serialWriteErrorMessage,
} from './laser-store-helpers';

export type SafeWriteRefs = {
  readonly connection: SerialConnection | null;
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
    const blockedMessage = idleOnlyDollarCommandBlockMessage(get(), line);
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
      const writeSource = source ?? transcriptSourceForWrite(line, action);
      await conn.write(line);
      set((s) => ({
        transcript: appendTranscript(
          s.transcript,
          outboundTranscriptEntry(refs.nextTranscriptId++, Date.now(), line, writeSource),
        ),
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

function transcriptSourceForWrite(
  line: string,
  action: LaserSafetyAction | undefined,
): TranscriptSource {
  if (line === RT_STATUS) return 'poll';
  if (action === 'start' || action === 'resume') return 'job';
  if (action === 'frame' || action === 'jog' || action === 'home') return 'motion';
  if (action === 'origin') return 'origin';
  if (action === 'unlock' || action === 'console') return 'console';
  return 'system';
}
