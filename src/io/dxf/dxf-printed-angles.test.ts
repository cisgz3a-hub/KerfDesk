// A whole DXF circle or ellipse arrives with its angles printed by the writer
// to some fixed precision. Whatever the start angle and the printing, the import
// must stay whole, never collapse into a dot (audit C2 E3-P1-1, E3-P1-2, E4-P1-1;
// ADR-700 Amd 4 and 5). Coarser printing than these formats is left as written.

import { describe, expect, it } from 'vitest';
import { normalizedSweep } from './dxf-curve-sampling';
import { arcSweep } from './dxf-entities';

const TURN = Math.PI * 2;
const STARTS = 1000;

type Format = { label: string; write: (value: number) => number };

function formats(decimals: readonly number[], significant: readonly number[]): Format[] {
  return [
    ...decimals.map((digits) => ({
      label: `${digits} decimals`,
      write: (value: number) => Number(value.toFixed(digits)),
    })),
    ...significant.map((digits) => ({
      label: `${digits} significant digits`,
      write: (value: number) => Number(value.toPrecision(digits)),
    })),
  ];
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** Repeatable start angles spread over [−turn, turn). */
function starts(turn: number): number[] {
  let state = 20261113;
  return Array.from({ length: STARTS }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32) * 2 * turn - turn;
  });
}

describe.each([
  {
    kind: 'ARC s → s + 360° (degrees)',
    turn: 360,
    sweep: (start: number, end: number) => arcSweep(start, end),
    formats: formats(range(1, 12), range(4, 12)),
  },
  {
    kind: 'ELLIPSE s → s + 2π (radians)',
    turn: TURN,
    sweep: (start: number, end: number) => normalizedSweep(start, end),
    formats: formats(range(2, 12), range(4, 12)),
  },
])('a whole $kind, printed', ({ turn, sweep, formats: printed }) => {
  it.each(printed.map((format) => [format.label, format] as const))(
    'to %s stays whole from every start angle',
    (_label, format) => {
      for (const start of starts(turn)) {
        const writtenStart = format.write(start);
        const writtenEnd = format.write(start + turn);
        const result = sweep(writtenStart, writtenEnd);
        // Never a dot, and never short by more than the printing's rounding.
        expect(result, `${writtenStart} → ${writtenEnd}`).toBeGreaterThan(TURN * 0.99);
        if (Math.abs(writtenEnd - writtenStart) >= turn) {
          expect(result, `${writtenStart} → ${writtenEnd}`).toBe(TURN);
        }
      }
    },
  );
});

describe('small sweeps a turn or more apart stay small', () => {
  it.each([
    [0, 360.5],
    [0, 360.2],
    [-10, 350.2],
  ])('ARC %s° → %s°', (start, end) => {
    expect(arcSweep(start, end)).toBeLessThan(0.01);
  });

  it.each([
    [0, TURN + 0.01],
    [0, TURN + 0.0099],
    [1, 1 + 2 * TURN + 0.0099],
  ])('ELLIPSE %s → %s', (start, end) => {
    expect(normalizedSweep(start, end)).toBeLessThan(0.011);
  });
});

describe('the cases the audit measured', () => {
  it.each([
    [-3.142, 3.142],
    [0, 6.284],
    [0, 6.29],
    [1.57, 7.854],
  ])('closes the ELLIPSE %s → %s', (start, end) => {
    expect(normalizedSweep(start, end)).toBe(TURN);
  });

  it.each([
    [12.26, 372.3],
    [123.5, 483.5],
    [-0.1235, 359.9],
  ])('keeps the ARC %s° → %s° a circle', (start, end) => {
    expect(arcSweep(start, end)).toBe(TURN);
  });
});
