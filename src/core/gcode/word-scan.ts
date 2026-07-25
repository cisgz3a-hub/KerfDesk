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

// Strips paired `(...)` inline comments (replaced by a space so adjacent words
// never fuse) and everything from `;`, then trims. An unclosed `(` is left in
// place — both parsers have always treated that as junk downstream, and this
// stage is a pure refactor.
export function stripInlineComments(line: string): string {
  const noParens = line.replace(/\([^)]*\)/g, ' ');
  const semicolon = noParens.indexOf(';');
  return (semicolon >= 0 ? noParens.slice(0, semicolon) : noParens).trim();
}
