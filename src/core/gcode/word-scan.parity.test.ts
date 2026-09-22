import { describe, expect, it } from 'vitest';
import { GCODE_WORD_PATTERN, scanGcodeWords, type GcodeWordMatch } from './word-scan';

// The regex the hand-rolled scanner replaced, kept here as the oracle.
function scanWithRegex(line: string): ReadonlyArray<GcodeWordMatch> {
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

// Deterministic LCG so a failure reproduces from its seed.
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const ALPHABET = [
  'G',
  'g',
  '1',
  '0',
  '5',
  'X',
  'y',
  'Z',
  '.',
  '+',
  '-',
  ' ',
  '\t',
  'M',
  'S',
  'e',
  'F',
  '(',
  ')',
  ';',
  '*',
  '/',
  'é',
];

describe('scanGcodeWords parity with GCODE_WORD_PATTERN', () => {
  it('matches the regex token for token on random input', () => {
    const random = pseudoRandom(20260922);
    for (let sample = 0; sample < 20_000; sample += 1) {
      const length = Math.floor(random() * 14);
      let line = '';
      for (let index = 0; index < length; index += 1) {
        line += ALPHABET[Math.floor(random() * ALPHABET.length)];
      }
      expect(scanGcodeWords(line), JSON.stringify(line)).toEqual(scanWithRegex(line));
    }
  });

  it.each([
    'G1 X10.5 Y-3 S500 F2500',
    'G1X95S0',
    'X-.5Y+.25',
    'X5.Y.',
    'X- 5',
    'XX5',
    '1X5',
    'X 5.5.5',
    'G01 X+1e2',
    'x\t7',
    'M3 S1000 ; comment X9',
    '',
    'X',
    '+5',
    'G92.1',
  ])('matches the regex on %j', (line) => {
    expect(scanGcodeWords(line)).toEqual(scanWithRegex(line));
  });
});
