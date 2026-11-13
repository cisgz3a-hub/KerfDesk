// A whole DXF circle or ellipse arrives with its angles printed by the writer
// to some fixed precision. Whatever the start angle and the printing, the import
// must stay whole, never collapse into a dot (audit C2 E3-P1-1, E3-P1-2, E4-P1-1;
// ADR-700 Amd 4-7). Coarser printing is left as written, by maintainer
// decision.

import { describe, expect, it } from 'vitest';
import { ARC_SNAPS, ELLIPSE_SNAPS, normalizedSweep, type TurnSnaps } from './dxf-curve-sampling';
import { arcSweep } from './dxf-entities';

const TURN = Math.PI * 2;
const STARTS = 5000;

/** `exact`: every angle rounded the same way at a fixed decimal place. */
type Format = { label: string; exact: boolean; write: (value: number) => number };

/** How the writer rounds each angle: to nearest, or always in one direction. */
const ROUNDINGS: ReadonlyArray<readonly [string, ((value: number) => number) | null]> = [
  ['nearest', null],
  ['rounded up', Math.ceil],
  ['rounded down', Math.floor],
  ['truncated', Math.trunc],
];

/** `value` rounded at the given decimal place (10^-place) by `direction`. */
function directed(value: number, place: number, direction: (value: number) => number): number {
  const scale = 10 ** place;
  return direction(value * scale) / scale;
}

function formats(decimals: readonly number[], significant: readonly number[]): Format[] {
  return ROUNDINGS.flatMap(([rounding, direction]) => [
    ...decimals.map((digits) => ({
      label: `${digits} decimals, ${rounding}`,
      exact: direction !== Math.trunc,
      write: (value: number) =>
        Number((direction === null ? value : directed(value, digits, direction)).toFixed(digits)),
    })),
    ...significant.map((digits) => ({
      label: `${digits} significant digits, ${rounding}`,
      exact: false,
      write: (value: number) => {
        if (direction === null || value === 0) return Number(value.toPrecision(digits));
        const place = digits - 1 - Math.floor(Math.log10(Math.abs(value)));
        return Number(directed(value, place, direction).toPrecision(digits));
      },
    })),
  ]);
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
        // Decimals rounded one way miss a whole turn by a fixed amount, inside
        // the allowance whichever side it falls (ADR-700 Amd 7).
        if (format.exact || Math.abs(writtenEnd - writtenStart) >= turn) {
          expect(result, `${writtenStart} → ${writtenEnd}`).toBe(TURN);
        }
      }
    },
  );
});

/** The counter-clockwise sweep the written numbers say, in radians, unsnapped. */
function asWritten(start: number, end: number, turn: number): number {
  const remainder = (end - start) % turn;
  return ((remainder <= 0 ? remainder + turn : remainder) / turn) * TURN;
}

/** Whether the shipped allowances close these written angles. */
function withinAllowance(start: number, end: number, turn: number, snaps: TurnSnaps): boolean {
  const difference = end - start;
  if (Math.abs(difference) < turn) return (turn - difference) / turn <= snaps.close;
  const turns = difference / turn;
  return Math.abs(turns - Math.round(turns)) <= snaps.wrap;
}

// Maintainer decision (ADR-700 Amd 5): coarser printing imports as its numbers
// say. Only rounding that lands inside the allowance anyway closes.
describe.each([
  {
    kind: 'ARC s → s + 360° (degrees)',
    turn: 360,
    snaps: ARC_SNAPS,
    sweep: (start: number, end: number) => arcSweep(start, end),
    formats: formats([], [3]),
  },
  {
    kind: 'ELLIPSE s → s + 2π (radians)',
    turn: TURN,
    snaps: ELLIPSE_SNAPS,
    sweep: (start: number, end: number) => normalizedSweep(start, end),
    formats: formats([1], [3]),
  },
])('a whole $kind, printed coarsely', ({ turn, snaps, sweep, formats: printed }) => {
  it.each(printed.map((format) => [format.label, format] as const))(
    'to %s stays as written',
    (_label, format) => {
      let leftAsWritten = 0;
      for (const start of starts(turn)) {
        const writtenStart = format.write(start);
        const writtenEnd = format.write(start + turn);
        const result = sweep(writtenStart, writtenEnd);
        const label = `${writtenStart} → ${writtenEnd}`;
        if (withinAllowance(writtenStart, writtenEnd, turn, snaps)) {
          expect(result, label).toBe(TURN);
        } else {
          expect(result, label).toBeCloseTo(asWritten(writtenStart, writtenEnd, turn), 9);
          leftAsWritten += 1;
        }
      }
      expect(leftAsWritten).toBeGreaterThan(STARTS / 10);
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
    [3.717, 10.01],
    [-3.14, 3.14],
    [0, 6.28],
    [-1.57, 4.71],
  ])('closes the ELLIPSE %s → %s', (start, end) => {
    expect(normalizedSweep(start, end)).toBe(TURN);
  });

  // Maintainer decisions: a symmetric pair at 2 decimals closes (E5-P3-2), one at
  // 1 decimal imports as written (E4-P1-1).
  it('leaves the ELLIPSE −3.1 → 3.1 open by its 0.083 rad gap', () => {
    expect(normalizedSweep(-3.1, 3.1)).toBeCloseTo(6.2, 12);
  });

  it.each([
    [12.26, 372.3],
    [123.5, 483.5],
    [-0.1235, 359.9],
  ])('keeps the ARC %s° → %s° a circle', (start, end) => {
    expect(arcSweep(start, end)).toBe(TURN);
  });
});
