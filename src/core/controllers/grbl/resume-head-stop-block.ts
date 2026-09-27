// The optional head-stop action needs a provable program point. The archived
// resume transform's modal-word scan is intentionally unchanged; it cannot
// reconstruct coordinate-frame changes or carry old axes across a unit switch.
import type { LaserResumeModalState } from './laser-resume-reentry';

type Word = { readonly letter: string; readonly value: number };

// Motion, dwell, plane, units, primary WCS, absolute positioning and arc mode.
const TRACKED_G_WORDS = new Set([0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 54, 90, 90.1, 91.1, 94]);
// Native laser power/air controls and planner synchronization, not tool changes
// or firmware commands whose coordinate effects this scan cannot reconstruct.
const TRACKED_M_WORDS = new Set([3, 4, 5, 7, 8, 9, 106, 107, 221, 400]);

export function canTrackHeadStopBlock(
  state: LaserResumeModalState,
  words: ReadonlyArray<Word>,
  remainder: string,
): boolean {
  if (!knownNonNumericWords(words, remainder)) return false;
  if (words.some((word) => word.letter === 'M' && !TRACKED_M_WORDS.has(word.value))) return false;
  const gWords = words.filter((word) => word.letter === 'G').map((word) => word.value);
  if (gWords.some((value) => !TRACKED_G_WORDS.has(value))) return false;
  if (!preservesAxisUnits(state, gWords)) return false;
  if (!words.some((word) => word.letter === 'X' || word.letter === 'Y')) return true;
  if (gWords.includes(4)) return false;
  if (state.motion === null && !gWords.some((value) => value >= 0 && value <= 3)) return false;
  return true;
}

function preservesAxisUnits(state: LaserResumeModalState, gWords: ReadonlyArray<number>): boolean {
  const nextUnits = gWords.includes(20) ? 'G20' : gWords.includes(21) ? 'G21' : state.units;
  return nextUnits === state.units || (state.x === null && state.y === null);
}

function knownNonNumericWords(words: ReadonlyArray<Word>, remainder: string): boolean {
  if (remainder === '') return true;
  // Smoothieware's generated beam-off command and Marlin's inline laser flag
  // have no XY effect; do not reject their ordinary generated programs.
  if (words.length === 0 && /^fire\s+(?:off|0)$/.test(remainder)) return true;
  return (
    /^I$/i.test(remainder) &&
    words.some(
      (word) =>
        (word.letter === 'M' && [3, 4, 5].includes(word.value)) ||
        (word.letter === 'G' && [1, 2, 3].includes(word.value)),
    )
  );
}
