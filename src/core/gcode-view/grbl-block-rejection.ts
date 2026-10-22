import {
  scanCompleteGcodeWords,
  stripControllerComments,
  type GcodeWordMatch,
} from '../gcode/word-scan';

// Stock GRBL only. Independently expressed from gnea/grbl bfb67f0 gcode.c,
// STEP 2/3: any failure discards the whole block before its modes execute.
// This is a review interpretation, never a stream rewrite or a Start guard.
const G_CODES = new Set([
  0, 1, 2, 3, 4, 10, 17, 18, 19, 20, 21, 28, 28.1, 30, 30.1, 38.2, 38.3, 38.4, 38.5, 40, 43.1, 49,
  53, 54, 55, 56, 57, 58, 59, 61, 80, 90, 91, 91.1, 92, 92.1, 93, 94,
]);
// M7 and M56 are build options; do not assert their rejection.
const M_CODES = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 30, 56]);

/** Known block-independent failures; null does not certify a valid program. */
export function grblBlockRejection(raw: string): string | null {
  const line = stripControllerComments(raw).trim();
  if (line === '' || line === '%') return null;
  const words = scanCompleteGcodeWords(line);
  if (words === null) return 'the line is not a complete sequence of G-code words';
  for (const word of words) {
    const rejected = rejectedValueWord(word) ?? rejectedCommand(word);
    if (rejected !== null) return rejected;
  }
  const hasG10 = words.some((word) => word.letter === 'G' && word.value === 10);
  const mode = words.find((word) => word.letter === 'L')?.value;
  if (hasG10 && mode !== undefined && ![2, 20].includes(Math.trunc(mode))) {
    return `G10 L${mode} is unsupported (stock GRBL accepts L2 or L20)`;
  }
  return null;
}

function rejectedValueWord(word: GcodeWordMatch): string | null {
  if ('FNPST'.includes(word.letter) && word.value < 0) return `${word.letter} cannot be negative`;
  if (!'GMFIJKLNPRSTXYZ'.includes(word.letter)) return `${word.letter} is unsupported`;
  if (word.letter === 'T' && word.value > 255) return 'T exceeds 255';
  if (word.letter === 'N' && Math.trunc(word.value) > 10_000_000) return 'N exceeds 10000000';
  return null;
}

function rejectedCommand(word: GcodeWordMatch): string | null {
  if (word.letter !== 'G' && word.letter !== 'M') return null;
  // Outside uint8 command range conversion is not portable: do not assert
  // rejection. GRBL checks fractional hundredths without carrying into the
  // integer command (G90.999 is invalid, not G91).
  if (word.value < 0 || word.value >= 256) return null;
  const whole = Math.trunc(word.value);
  const fraction = Math.round((word.value - whole) * 100);
  // Stock G49 clears the mantissa in its handler, including G49.x.
  if (word.letter === 'G' && whole === 49) return null;
  const codes = word.letter === 'G' ? G_CODES : M_CODES;
  return fraction < 100 && codes.has(whole + fraction / 100)
    ? null
    : `${word.letter}${word.value} is unsupported`;
}

/** Optional commands can reject their companion mode/motion words too. */
export function grblBlockUncertainty(raw: string): string | null {
  const words = scanCompleteGcodeWords(stripControllerComments(raw));
  if (words === null) return null;
  const uncertain = words.some(
    (word) =>
      (word.letter === 'M' &&
        [7, 56].includes(Math.round(word.value * 100) / 100) &&
        words.length > 1) ||
      ('GM'.includes(word.letter) && (word.value < 0 || word.value >= 256)),
  );
  return uncertain
    ? 'Stock GRBL acceptance of this block depends on firmware build options or command-number conversion. Its effects and following coordinates cannot be established, so they are not placed in the Frame outline.'
    : null;
}

export function grblRejectedBlockWarning(reason: string): string {
  return `Stock GRBL rejects this whole block: ${reason}. Its modes, tool settings and motion do not apply. The original line is still sent; an error stops the job, but later buffered lines may already run.`;
}
