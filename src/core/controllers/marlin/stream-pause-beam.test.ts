// Controller audit MA-1: a Marlin stream-side Pause queues the beam-off of the
// job's own power commands behind the buffered motion, and Resume switches the
// beam back on in those commands (ADR-364's transform-3 rules).
import { describe, expect, it } from 'vitest';
import { planMarlinStreamPauseBeam } from './stream-pause-beam';

function streamLines(text: string): ReadonlyArray<string> {
  return text
    .trim()
    .split('\n')
    .map((line) => `${line.trim()}\n`);
}

// The shape marlin-inline-transform.ts writes: S on the first G1 after a G0,
// later burn moves keep it modally.
const INLINE = streamLines(`
M5 I
G21
G90
M3 I S0
G0 X5.000 Y5.000 S0
G1 X10.000 F1500 S0
G1 X11.000 S64
G1 X16.000 ; burn continues
G1 X20.000
M5 I
G0 X0.000 Y0.000 S0
`);

// The shape marlin-fan-transform.ts writes: M106 on the line before a burn
// move, M107 before travel.
const FAN = streamLines(`
G21
G90
M107
G0 X15.000 Y175.000
G1 X20.000 F1500
M106 S102
G1 X28.000 F1500
M107
G1 X33.000 F1500
M8
M106 S26
G1 X40.000
`);

describe('planMarlinStreamPauseBeam — inline (M3 I)', () => {
  it('switches off with M5 I, re-arms with M3 I S0 and restates the held S on the next burn', () => {
    expect(planMarlinStreamPauseBeam(INLINE, 7)).toEqual({
      offLines: ['M5 I'],
      restoreLines: ['M3 I S0'],
      restatedLine: { offset: 0, line: 'G1 X16.000 S64 ; burn continues\n' },
    });
  });

  it('restates nothing when the next move sets its own power or zeroes it', () => {
    expect(planMarlinStreamPauseBeam(INLINE, 6).restatedLine).toBeNull();
    const beforeTravel = [...INLINE.slice(0, 7), 'G0 X30.000 Y5.000 S0\n', ...INLINE.slice(7)];
    expect(planMarlinStreamPauseBeam(beforeTravel, 7)).toMatchObject({
      offLines: ['M5 I'],
      restoreLines: ['M3 I S0'],
      restatedLine: null,
    });
  });

  it('does nothing between passes, after M5 I left inline mode', () => {
    expect(planMarlinStreamPauseBeam(INLINE, 10)).toEqual({
      offLines: [],
      restoreLines: [],
      restatedLine: null,
    });
  });

  it('re-arms dynamic inline mode as M4 I S0', () => {
    const dynamic = streamLines('M4 I S0\nG1 X5 F900 S120\nG1 X9\n');
    expect(planMarlinStreamPauseBeam(dynamic, 2)).toEqual({
      offLines: ['M5 I'],
      restoreLines: ['M4 I S0'],
      restatedLine: { offset: 0, line: 'G1 X9 S120\n' },
    });
  });
});

describe('planMarlinStreamPauseBeam — fan (M106)', () => {
  it('switches off with M107 and restores the held M106 S right before the next move', () => {
    expect(planMarlinStreamPauseBeam(FAN, 6)).toEqual({
      offLines: ['M107'],
      restoreLines: ['M106 S102'],
      restatedLine: null,
    });
  });

  it('does not restore when the program sets the fan itself first', () => {
    expect(planMarlinStreamPauseBeam(FAN, 7)).toEqual({
      offLines: ['M107'],
      restoreLines: [],
      restatedLine: null,
    });
  });

  it('does not light the standing head while a non-move line runs first', () => {
    const lit = [...FAN.slice(0, 7), 'M8\n', 'G1 X30.000\n'];
    expect(planMarlinStreamPauseBeam(lit, 7).restoreLines).toEqual([]);
  });

  it('switches nothing off once M107 ran', () => {
    expect(planMarlinStreamPauseBeam(FAN, 8).offLines).toEqual([]);
  });
});

describe('planMarlinStreamPauseBeam — neither', () => {
  it('plans nothing for a job that never lit the beam, or at its end', () => {
    const plain = streamLines('G21\nG90\nG0 X1 Y1\nG1 X5 F600\n');
    expect(planMarlinStreamPauseBeam(plain, 3)).toEqual({
      offLines: [],
      restoreLines: [],
      restatedLine: null,
    });
    expect(planMarlinStreamPauseBeam(INLINE.slice(0, 8), 8)).toEqual({
      offLines: ['M5 I'],
      restoreLines: [],
      restatedLine: null,
    });
  });
});
