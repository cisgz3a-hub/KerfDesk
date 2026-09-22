// Shared low-level G-code word scanning (ADR-255 stage 1). One regex and one
// comment-stripper serve both modal parsers — the F-CNC10 simulator parser
// (io/gcode/parse-gcode-program.ts) and the motion manifest
// (core/job/motion-manifest-parser.ts) — so tokenization can never drift
// between them again.

export const INCH_TO_MM = 25.4;

// A word is one letter followed by a signed decimal number. The two parsers
// previously each declared this exact pattern.
export const GCODE_WORD_PATTERN = /([A-Za-z])[ \t]*([+-]?(?:\d+\.?\d*|\.\d+))/g;

export type GcodeWordMatch = {
  /** Uppercased word letter (`G`, `M`, `X`, …). */
  readonly letter: string;
  readonly value: number;
  /** Raw matched length — feeds the simulator parser's whole-line junk heuristic. */
  readonly matchedLength: number;
};

// A hand-rolled scan of GCODE_WORD_PATTERN. The pattern is executed for every
// motion line by the preflight scanners, the manifest parser and the timeline,
// and a dense fill is hundreds of thousands of lines; `matchAll` allocated an
// iterator plus a match array per word. This loop recognises exactly the same
// tokens (`word-scan.parity.test.ts` pins it against the regex on random
// input): a letter, optional blanks, an optional sign, then either digits with
// an optional fraction or a bare fraction.
export function scanGcodeWords(line: string): ReadonlyArray<GcodeWordMatch> {
  const out: GcodeWordMatch[] = [];
  const length = line.length;
  let index = 0;
  while (index < length) {
    const letterCode = line.charCodeAt(index);
    if (!isAsciiLetter(letterCode)) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < length && isBlank(line.charCodeAt(cursor))) cursor += 1;
    const numberStart = cursor;
    if (cursor < length && isSign(line.charCodeAt(cursor))) cursor += 1;
    const numberEnd = scanNumberEnd(line, cursor);
    if (numberEnd < 0) {
      index += 1;
      continue;
    }
    out.push({
      letter: String.fromCharCode(letterCode).toUpperCase(),
      value: Number.parseFloat(line.slice(numberStart, numberEnd)),
      matchedLength: numberEnd - index,
    });
    index = numberEnd;
  }
  return out;
}

/** End of `\d+\.?\d*` or `\.\d+` starting at `start`, or -1 when neither matches. */
function scanNumberEnd(line: string, start: number): number {
  const digitsEnd = scanDigits(line, start);
  if (digitsEnd > start) return scanOptionalFraction(line, digitsEnd);
  return scanBareFraction(line, start);
}

function scanDigits(line: string, start: number): number {
  let cursor = start;
  while (cursor < line.length && isDigit(line.charCodeAt(cursor))) cursor += 1;
  return cursor;
}

/** `\.?\d*` after the integer digits: a dot alone is still part of the number. */
function scanOptionalFraction(line: string, cursor: number): number {
  if (cursor < line.length && line.charCodeAt(cursor) === DOT) return scanDigits(line, cursor + 1);
  return cursor;
}

/** `\.\d+`: a dot needs at least one digit to be a number on its own. */
function scanBareFraction(line: string, cursor: number): number {
  if (cursor >= line.length || line.charCodeAt(cursor) !== DOT) return -1;
  const fractionEnd = scanDigits(line, cursor + 1);
  return fractionEnd > cursor + 1 ? fractionEnd : -1;
}

const DOT = 46;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isBlank(code: number): boolean {
  return code === 32 || code === 9;
}

function isSign(code: number): boolean {
  return code === 43 || code === 45;
}

/**
 * Scan a complete, comment-free G-code block.
 *
 * Adjacent words such as `G1X5` are valid, and whitespace may appear between a
 * letter and its value. Any other non-whitespace text means the block is not a
 * sequence of complete words. Inspector consumers use this stricter view so a
 * numeric prefix such as `X10junk` cannot become preview motion while the
 * trailing text is merely ignored. Returning `null` is diagnostic only; it
 * does not reject an import or make external G-code executable.
 */
export function scanCompleteGcodeWords(
  line: string,
  parseValue?: (letter: string, text: string) => number,
): ReadonlyArray<GcodeWordMatch> | null {
  const framed = stripDiagnosticBlockFraming(line);
  const words: GcodeWordMatch[] = [];
  let consumedThrough = 0;
  for (const match of framed.matchAll(GCODE_WORD_PATTERN)) {
    const start = match.index;
    if (framed.slice(consumedThrough, start).trim() !== '') return null;
    const letter = (match[1] ?? '').toUpperCase();
    const text = match[2] ?? '0';
    words.push({
      letter,
      value: parseValue === undefined ? Number.parseFloat(text) : parseValue(letter, text),
      matchedLength: match[0].length,
    });
    consumedThrough = start + match[0].length;
  }
  return framed.slice(consumedThrough).trim() === '' ? words : null;
}

function stripDiagnosticBlockFraming(line: string): string {
  let block = line.trim();
  // Common external files may retain controller framing: `/` is the optional
  // block-delete prefix, while Marlin-style streamed files often carry a
  // trailing `*<checksum>`. These wrappers are diagnostic metadata, not G-code
  // words, so preview/glossary consumers may ignore them without making the
  // imported program executable.
  if (block.startsWith('/')) block = block.slice(1).trimStart();
  const checksum = /\*[ \t]*[+-]?\d+[ \t]*$/.exec(block);
  if (checksum !== null) block = block.slice(0, checksum.index).trimEnd();
  return block;
}

// Strips paired `(...)` inline comments (replaced by a space so adjacent words
// never fuse) and everything from `;`, then trims. An unclosed `(` is left in
// place — both parsers have always treated that as junk downstream, and this
// stage is a pure refactor.
export function stripInlineComments(line: string): string {
  const noParens = line.replace(/\([^)]*\)/g, ' ');
  const semicolon = noParens.indexOf(';');
  return (semicolon >= 0 ? noParens.slice(0, semicolon) : noParens).trim();
}
