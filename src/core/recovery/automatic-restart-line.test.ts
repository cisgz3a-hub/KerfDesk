import { describe, expect, it } from 'vitest';
import { automaticRestart } from './automatic-restart-line';
import { rawResumeLine } from './job-checkpoint';
import type { JobInterruption } from './job-interruption';

const PROGRAM = [
  '; header',
  'G21',
  'G90',
  '',
  'M4 S0',
  'G0 X0 Y0 S0',
  'G1 X1 F600 S100', // sendable 5, raw 7
  'X2 S200', // sendable 6, raw 8
  '  X3 S300\r', // sendable 7, raw 9
  'X4 S400', // sendable 8, raw 10
  'M5', // sendable 9, raw 11
].join('\n');

function rejected(line: string): JobInterruption {
  return { kind: 'controller-error', message: 'error:1', rejectedLine: line };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('automatic recovery restart line', () => {
  it('matches rawResumeLine for every acknowledged count when nothing was rejected', () => {
    const random = mulberry32(99);
    for (let program = 0; program < 200; program += 1) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 30) }, () => {
        const roll = random();
        if (roll < 0.15) return '';
        if (roll < 0.3) return '; note';
        return `G1 X${Math.floor(random() * 50)}`;
      });
      const gcode = lines.join('\n') + (random() < 0.5 ? '\n' : '');
      for (let acked = 0; acked <= lines.length + 2; acked += 1) {
        for (const interruption of [undefined, { kind: 'disconnect', message: 'lost' } as const]) {
          expect(automaticRestart(gcode, acked, interruption)).toEqual({
            line: rawResumeLine(gcode, acked),
            replaysRejectedLine: false,
          });
        }
      }
    }
  });

  it('restarts at the rejected line the stream counted as acknowledged', () => {
    // error:1 answered sendable line 6 (raw 8); the stream counted it.
    expect(automaticRestart(PROGRAM, 6, rejected('X2 S200'))).toEqual({
      line: 8,
      replaysRejectedLine: true,
    });
    expect(rawResumeLine(PROGRAM, 6)).toBe(9);
  });

  it('finds the rejected line behind answers that arrived before the stop took effect', () => {
    expect(automaticRestart(PROGRAM, 8, rejected('X2 S200'))).toEqual({
      line: 8,
      replaysRejectedLine: true,
    });
  });

  it('compares the streamed text: trimmed, whatever the raw line spacing', () => {
    expect(automaticRestart(PROGRAM, 7, rejected('X3 S300'))).toEqual({
      line: 9,
      replaysRejectedLine: true,
    });
  });

  it('chooses the nearest earlier copy of a repeated line', () => {
    const repeated = ['G1 X0 F600 S100', 'X1 S100', 'X2 S200', 'X1 S100', 'X2 S200', 'M5'].join(
      '\n',
    );
    expect(automaticRestart(repeated, 4, rejected('X1 S100')).line).toBe(4);
    expect(automaticRestart(repeated, 5, rejected('X1 S100')).line).toBe(4);
    expect(automaticRestart(repeated, 3, rejected('X1 S100')).line).toBe(2);
  });

  it('falls back to the acknowledged count when the rejected text is absent or too far back', () => {
    expect(automaticRestart(PROGRAM, 6, rejected('G1 X99'))).toEqual({
      line: rawResumeLine(PROGRAM, 6),
      replaysRejectedLine: false,
    });
    const long = ['G1 X0 F600 S100', ...Array.from({ length: 400 }, (_, i) => `X${i + 1} S100`)];
    expect(automaticRestart(long.join('\n'), 300, rejected('G1 X0 F600 S100'))).toEqual({
      line: rawResumeLine(long.join('\n'), 300),
      replaysRejectedLine: false,
    });
    expect(automaticRestart(long.join('\n'), 256, rejected('G1 X0 F600 S100')).line).toBe(1);
  });

  it('ignores a rejected line on any other interruption, and an empty one', () => {
    const cancelled: JobInterruption = { kind: 'cancelled', message: 'x', rejectedLine: 'X2 S200' };
    expect(automaticRestart(PROGRAM, 6, cancelled).line).toBe(9);
    expect(automaticRestart(PROGRAM, 6, rejected('   ')).line).toBe(9);
    expect(automaticRestart(PROGRAM, 0, rejected('X2 S200')).line).toBe(rawResumeLine(PROGRAM, 0));
  });
});
