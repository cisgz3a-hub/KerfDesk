// Which of a job's warnings a beginner sees first (UX audit U3-P3-6, U4-P2-6,
// ADR-687). Job Review and Save G-code share one ranking:
// - beginner: what to do before the burn (a material test, cut last, check the
//   material under the Frame box);
// - warning: everything not named here, kept in view as before;
// - technical: motion-policy notes a beginner cannot act on, folded under
//   Technical notes (scan offsets, which S value 100 % means, runway policy).
// Unknown text ranks as a warning, so a new warning is never hidden.
import { UNKNOWN_NATIVE_BED_MESSAGE } from '../state/native-bed-frame';
import { isPowerScaleSourceNote } from './connected-laser-power-scale';
import { isCutBeforeEngravingWarning } from './cut-order-warnings';
import { isTechnicalJobIntentNote } from './job-intent-warnings';
import { isUncalibratedDefaultsWarning } from './uncalibrated-job-warnings';

export type ReviewNoteRank = 'beginner' | 'warning' | 'technical';

export function reviewNoteRank(note: string): ReviewNoteRank {
  if (
    isUncalibratedDefaultsWarning(note) ||
    isCutBeforeEngravingWarning(note) ||
    note.startsWith(UNKNOWN_NATIVE_BED_MESSAGE)
  ) {
    return 'beginner';
  }
  if (isTechnicalJobIntentNote(note) || isPowerScaleSourceNote(note)) return 'technical';
  return 'warning';
}

export type RankedReviewNotes = {
  readonly beginner: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly technical: ReadonlyArray<string>;
};

/** Splits notes by rank, keeping each rank's own order. */
export function rankReviewNotes(notes: ReadonlyArray<string>): RankedReviewNotes {
  const beginner: string[] = [];
  const warnings: string[] = [];
  const technical: string[] = [];
  for (const note of notes) {
    const rank = reviewNoteRank(note);
    (rank === 'beginner' ? beginner : rank === 'technical' ? technical : warnings).push(note);
  }
  return { beginner, warnings, technical };
}

export function technicalNotesLabel(count: number): string {
  return `Technical notes (${count})`;
}
