import { describe, expect, it } from 'vitest';
import { findFirstSendableLineOver, hasSendableGcodeLine } from './sendable-line-scan';
import { isSendableGcodeLine } from './streamer';

// The definition the scans must keep: splitLines in streamer.ts.
function splitLinesOracle(gcode: string): string[] {
  return gcode
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => isSendableGcodeLine(line))
    .map((line) => `${line}\n`);
}

function oversizedOracle(
  gcode: string,
  limit: number,
): { lineNumber: number; bytes: number } | null {
  const lines = splitLinesOracle(gcode);
  for (let index = 0; index < lines.length; index += 1) {
    const bytes = lines[index]?.length ?? 0;
    if (bytes > limit) return { lineNumber: index + 1, bytes };
  }
  return null;
}

const PIECES = [
  'G1X12.5Y3',
  'G0 X0 Y0',
  '; comment',
  '  ;indented comment',
  '',
  ' ',
  '\t',
  '\r',
  ' ',
  ' ',
  '﻿',
  'M3 S1000',
  'G1 X100.000 Y200.000 S1000 F1500',
  'X'.repeat(130),
  ` ${'Y'.repeat(118)} `,
  '　G1',
];

function program(seed: number): string {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  const lines: string[] = [];
  const count = next() % 40;
  for (let index = 0; index < count; index += 1) {
    const parts = next() % 3;
    let line = '';
    for (let part = 0; part <= parts; part += 1) line += PIECES[next() % PIECES.length];
    lines.push(line);
  }
  return lines.join('\n') + (next() % 2 === 0 ? '\n' : '');
}

describe('allocation-light sendable-line scans', () => {
  it('match splitLines over fuzzed programs, whitespace and limits', () => {
    for (let seed = 1; seed <= 4000; seed += 1) {
      const gcode = program(seed);
      const limit = [8, 20, 120, 127, 128, 4096][seed % 6] ?? 120;
      expect(hasSendableGcodeLine(gcode)).toBe(splitLinesOracle(gcode).length > 0);
      expect(findFirstSendableLineOver(gcode, limit)).toEqual(oversizedOracle(gcode, limit));
    }
  });

  it('handles empty, comment-only and single-line programs', () => {
    expect(hasSendableGcodeLine('')).toBe(false);
    expect(hasSendableGcodeLine('\n; only\n  \n')).toBe(false);
    expect(hasSendableGcodeLine('G0 X1')).toBe(true);
    expect(findFirstSendableLineOver('G0 X1', 5)).toEqual({ lineNumber: 1, bytes: 6 });
    expect(findFirstSendableLineOver('G0 X1', 6)).toBeNull();
  });
});
