import { describe, expect, it } from 'vitest';
import {
  countSendableGcodeLines,
  measureSendableLines,
  findFirstSendableLineOver,
  findFirstUnencodableSendableLine,
  hasSendableGcodeLine,
  longestSendableLineSpan,
  unencodableLineMessage,
} from './sendable-line-scan';
import { findOversizedLine, isSendableGcodeLine } from './streamer';

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
      const queued = splitLinesOracle(gcode);
      expect(countSendableGcodeLines(gcode)).toBe(queued.length);
      expect(measureSendableLines(gcode)).toEqual({
        lines: queued.length,
        bytes: queued.reduce((sum, line) => sum + line.length, 0),
      });
    }
  });

  it('handles empty, comment-only and single-line programs', () => {
    expect(hasSendableGcodeLine('')).toBe(false);
    expect(hasSendableGcodeLine('\n; only\n  \n')).toBe(false);
    expect(hasSendableGcodeLine('G0 X1')).toBe(true);
    expect(findFirstSendableLineOver('G0 X1', 5)).toEqual({ lineNumber: 1, bytes: 6 });
    expect(findFirstSendableLineOver('G0 X1', 6)).toBeNull();
  });

  it('finds the first sendable line carrying a byte the wire cannot send as text', () => {
    const gcode = [
      'G21',
      '; full-line comments never stream: Ø 45°',
      'G1 X1',
      'G1 X2\u00a0',
      'G1 X10 ; Ø5 mm',
      'G1 X20 (45° corner)',
    ].join('\n');
    const found = findFirstUnencodableSendableLine(gcode);
    expect(found?.lineNumber).toBe(4);
    expect(found?.error.codePoint).toBe(0xd8);
    expect(found === null ? '' : unencodableLineMessage(found)).toMatch(
      /^G-code line 4: Not sent: the command contains "Ø"/,
    );
    expect(findFirstUnencodableSendableLine('G21\nG1 X1 Y2 ; plain\n')).toBeNull();
  });
});

describe('longestSendableLineSpan', () => {
  // Job Review skips the oversized-line scan below this span (ADR-598 Amd 4),
  // so the shortcut must agree with the scan at every limit.
  const programs = [
    '',
    'G21\n',
    '  G1 X1 Y2   \n; a long comment that is never sent to the controller at all\nM5\n',
    '\tG0 X100.25 Y20.5\r\n\nG1 X1\n   \n(paren) G1 X2\n',
    `G21\n${'G1 X1.234 Y5.678 S1000 F6000'.repeat(4)}   \nM5`,
  ];
  it.each(programs)('finds no line over any limit at or above it in %j', (gcode) => {
    const span = longestSendableLineSpan(gcode);
    for (let limit = 1; limit <= span + 4; limit += 1) {
      if (limit >= span) expect(findFirstSendableLineOver(gcode, limit)).toBeNull();
      expect(findOversizedLine(gcode, limit, span)).toEqual(findOversizedLine(gcode, limit));
    }
  });
});
