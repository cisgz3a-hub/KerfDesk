// Plain-language meaning for every G-code word on a line (ADR-255 §12 level
// L5 — "smallest detail"). Pure and testable: tokenizing reuses the shared
// scanner, so the glossary can never disagree with the parser about what a
// word IS — only about how to describe it.

import { scanGcodeWords, stripInlineComments } from '../../core/gcode';

export type WordExplanation = {
  /** The word as written, e.g. "G1" or "X12.5". */
  readonly text: string;
  /** One short sentence, sentence case, no trailing period. */
  readonly meaning: string;
};

const G_CODES = new Map<number, string>([
  [0, 'Rapid move — fastest traverse, not feed-limited'],
  [1, 'Linear move at the feed rate'],
  [2, 'Clockwise arc'],
  [3, 'Counter-clockwise arc'],
  [4, 'Dwell — pause for P seconds'],
  [17, 'Work in the XY plane'],
  [18, 'Work in the XZ plane'],
  [19, 'Work in the YZ plane'],
  [20, 'Units are inches'],
  [21, 'Units are millimetres'],
  [28, 'Return to the machine home position'],
  [53, 'Move in machine coordinates for this line'],
  [90, 'Coordinates are absolute'],
  [91, 'Coordinates are relative to the current position'],
  [92, 'Set the current position without moving'],
  [93, 'Feed is inverse time'],
  [94, 'Feed is units per minute'],
  [95, 'Feed is units per revolution'],
]);

const M_CODES = new Map<number, string>([
  [0, 'Program pause — waits for the operator'],
  [1, 'Optional pause'],
  [2, 'Program end'],
  [3, 'Spindle on clockwise / laser on at constant power'],
  [4, 'Spindle on counter-clockwise / laser on at dynamic power'],
  [5, 'Spindle or laser off'],
  [6, 'Tool change'],
  [7, 'Mist coolant on'],
  [8, 'Flood coolant on'],
  [9, 'Coolant off'],
  [30, 'Program end and rewind'],
  [106, 'Fan / laser on (Marlin dialect)'],
  [107, 'Fan / laser off (Marlin dialect)'],
]);

const LETTERS: Readonly<Record<string, string>> = {
  X: 'X target',
  Y: 'Y target',
  Z: 'Z target — depth or height',
  A: 'A rotary target',
  B: 'B rotary target',
  C: 'C rotary target',
  I: 'Arc centre offset from the start, along X',
  J: 'Arc centre offset from the start, along Y',
  K: 'Arc centre offset from the start, along Z',
  R: 'Arc radius',
  F: 'Feed rate',
  S: 'Spindle speed or laser power',
  P: 'Parameter — dwell seconds for G4',
  T: 'Select tool',
  N: 'Line number (ignored by the controller)',
};

export function explainLine(rawLine: string): ReadonlyArray<WordExplanation> {
  const stripped = stripInlineComments(rawLine);
  if (stripped === '' || stripped === '%') return [];
  return scanGcodeWords(stripped).map((word) => ({
    text: `${word.letter}${word.value}`,
    meaning: explainWord(word.letter, word.value),
  }));
}

function explainWord(letter: string, value: number): string {
  if (letter === 'G') return codeMeaning(G_CODES, value, 'G');
  if (letter === 'M') return codeMeaning(M_CODES, value, 'M');
  return LETTERS[letter] ?? `${letter} word`;
}

function codeMeaning(table: ReadonlyMap<number, string>, value: number, letter: string): string {
  const known = table.get(value);
  if (known !== undefined) return known;
  if (letter === 'G' && isWcs(value)) return `Select work coordinate system G${value}`;
  return `${letter}${value} — not interpreted by the Inspector`;
}

function isWcs(value: number): boolean {
  return Number.isInteger(value) && value >= 54 && value <= 59;
}
