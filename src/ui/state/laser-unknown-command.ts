// laser-unknown-command — a job line the firmware skipped (controller audit
// MA-12). Marlin answers a command its build has no handler for with
// `echo:Unknown command: "M8"` and then an ordinary `ok` for the same line
// (gcode.cpp L1101-L1122). It runs lines in order, so the echo belongs to the
// oldest line still owed an answer. When that is the job line the stream is
// waiting on, the `ok` that follows is handled as GRBL's error:20 is: the
// stream stops as errored and the safety notice names the skipped command.
//
// The echo need not read like that line. Marlin echoes the bytes it read, and a
// line without `N` has no checksum, so a first byte lost on the wire turns `M107`
// into `Unknown command: "107"`. Marlin skipped that line whole, whatever the
// echo says, and a skipped beam-off burns the next travel across the workpiece
// (rolling audit v9 R1-P1-1, ADR-676 Amendment 2). So only one echo is left in
// the log during a job: one that reads as a non-job line still owed a reply (a
// Console query, a stop line). An owned command outside a job is refused by its
// own arbiter (laser-interactive-command.ts).
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122

import type { ControllerEvent } from '../../core/controllers';
import { echoedCommandMatchesLine } from '../../core/controllers/controller-event';
import type { SkippedCommand } from './laser-safety-notice';
import { streamOwnsTerminalAck } from './laser-stream-ack';
import type { LaserState } from './laser-store';
import { owesUntrackedLine, type UntrackedAckLedgerRefs } from './laser-untracked-ack-ledger';

type UnknownCommandEvent = Extract<ControllerEvent, { readonly kind: 'unknown-command' }>;

type PendingSkippedLine = {
  readonly skipped: SkippedCommand;
  readonly writeEpoch: number;
};

export type UnknownCommandRefs = UntrackedAckLedgerRefs & {
  /** The in-flight job line Marlin reported skipped; its `ok` is next. */
  skippedStreamLine?: PendingSkippedLine | null;
};

const LIVE_STREAM_STATUSES: ReadonlyArray<string> = ['streaming', 'paused', 'tool-change'];

/** The skipped command an Unknown-command event reports. */
export function skippedCommandOf(event: UnknownCommandEvent): SkippedCommand {
  return { command: event.command, raw: event.raw, requirement: event.requirement };
}

/** Records an Unknown-command echo for the job line the stream waits on. */
export function noteStreamUnknownCommand(
  refs: UnknownCommandRefs,
  state: Pick<LaserState, 'streamer' | 'pendingUntrackedAcks'>,
  event: UnknownCommandEvent,
): void {
  const streamer = state.streamer;
  const line = streamer?.inFlight[0]?.line;
  if (streamer === null || line === undefined) return;
  if (!LIVE_STREAM_STATUSES.includes(streamer.status) || !streamOwnsTerminalAck(state)) return;
  const namesJobLine = echoedCommandMatchesLine(event.command, line);
  if (
    !namesJobLine &&
    owesUntrackedLine(refs, (sent) => echoedCommandMatchesLine(event.command, sent))
  )
    return;
  refs.skippedStreamLine = {
    skipped: {
      ...skippedCommandOf(event),
      ...(namesJobLine ? {} : { damagedLine: line.trim() }),
    },
    writeEpoch: refs.writeEpoch ?? 0,
  };
}

/** The skipped job line a stream-owned `ok` answers, consumed once. A reboot
 * in between (a new write epoch) voids it. */
export function takeStreamUnknownCommand(refs: UnknownCommandRefs): SkippedCommand | null {
  const pending = refs.skippedStreamLine ?? null;
  refs.skippedStreamLine = null;
  if (pending === null || pending.writeEpoch !== (refs.writeEpoch ?? 0)) return null;
  return pending.skipped;
}
