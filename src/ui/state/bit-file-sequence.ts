// bit-file-sequence — the gap between KerfDesk per-bit files run through Run
// G-code file is a bit change (rolling audit v4 H3-P2-2, ADR-392 Amendment 4).
//
// Start's M0 hold voids the previous bit's Work Z, waits for the new bit's
// zero, and refuses every X/Y origin change, because the rest of the job is
// placed on the X/Y origin it started with (tool-change-hold-entry.ts,
// ADR-375 Amendment 3). A setup package's one-file-per-bit files and a tile's
// bit files have no M0: the bit change falls between two external runs, where
// none of that happened. Frame accepted the previous bit's Work Z, and Set
// origin could move the X/Y zero the later bits must share.
//
// So the store records the per-bit file an external run streams. When that
// run's streamer is released (completed or failed), or at the first Idle after
// Abort, an alarm or a reset stopped it (its cancelled streamer is never
// released; ADR-392 Amendment 5), its Work Z goes, as at a hold's entry, so the
// next file's CNC Frame refuses until Zero Z or a probe sets the new bit's zero. While later bits of the set remain, X/Y origin
// writers are refused as in a hold. The set ends when its last file has run,
// when the controller session ends, or when the operator ends it.

import type { KerfDeskBitFile } from '../../core/external-program/kerfdesk-bit-file';
import type { LaserState } from './laser-store';

export type BitFileSequenceState = {
  /** The per-bit file an external run is streaming. */
  readonly bitFileRun?: KerfDeskBitFile | null;
  /** The last per-bit file that ran while later bits of its set remain. */
  readonly bitFileSequence?: KerfDeskBitFile | null;
};

/** Installed with every stream: an external per-bit file, or none. */
export function bitFileRunStartPatch(
  bitFile: KerfDeskBitFile | undefined,
): Pick<BitFileSequenceState, 'bitFileRun'> {
  return { bitFileRun: bitFile ?? null };
}

/** Applied where the streamer is released: a per-bit file's Work Z belongs to
 * its bit, and a set with later bits holds its X/Y origin. */
export function bitFileRunEndPatch(
  state: Pick<LaserState, 'workZReferenceEpoch'> & BitFileSequenceState,
): Partial<LaserState> {
  const run = state.bitFileRun;
  if (run === null || run === undefined) return {};
  return {
    bitFileRun: null,
    bitFileSequence: run.order < run.count ? run : null,
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
  };
}

export const END_BIT_SEQUENCE_LABEL = 'End bit sequence';

/** Why an X/Y origin writer waits between a set's bit files, or null. */
export function bitFileSequenceXyOriginBlockMessage(state: BitFileSequenceState): string | null {
  const ran = state.bitFileSequence;
  if (ran === null || ran === undefined) return null;
  return (
    `Bit ${ran.order} of ${ran.count} (${ran.bitName}) ran on this X/Y origin, and the files ` +
    'for the later bits must cut on the same one. Set or Reset origin and the XYZ corner probe ' +
    `wait until bit ${ran.count}'s file has run; use the Z probe or Zero Z for the new bit. To ` +
    `start over on new stock instead, choose ${END_BIT_SEQUENCE_LABEL} under Job.`
  );
}

/** What the machine panel says between a set's bit files, or null. */
export function bitFileSequenceNotice(state: BitFileSequenceState): string | null {
  const ran = state.bitFileSequence;
  if (ran === null || ran === undefined) return null;
  return (
    `Bit ${ran.order} of ${ran.count} (${ran.bitName}) has run. Change to bit ${ran.order + 1}, ` +
    'then Zero Z on the stock top or probe it before its file: Work Z from the last bit no ' +
    'longer applies. The X/Y origin stays where it is until the last bit has run.'
  );
}
