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

export function scanGcodeWords(line: string): ReadonlyArray<GcodeWordMatch> {
  const out: GcodeWordMatch[] = [];
  for (const match of line.matchAll(GCODE_WORD_PATTERN)) {
    out.push({
      letter: (match[1] ?? '').toUpperCase(),
      value: Number.parseFloat(match[2] ?? '0'),
      matchedLength: match[0].length,
    });
  }
  return out;
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
export function scanCompleteGcodeWords(line: string): ReadonlyArray<GcodeWordMatch> | null {
  const framed = stripDiagnosticBlockFraming(line);
  const words: GcodeWordMatch[] = [];
  let consumedThrough = 0;
  for (const match of framed.matchAll(GCODE_WORD_PATTERN)) {
    const start = match.index;
    if (framed.slice(consumedThrough, start).trim() !== '') return null;
    words.push({
      letter: (match[1] ?? '').toUpperCase(),
      value: Number.parseFloat(match[2] ?? '0'),
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
