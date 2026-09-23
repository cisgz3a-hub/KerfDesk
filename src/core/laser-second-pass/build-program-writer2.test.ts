// Writer 2 of the painted pass (ADR-341 Amendment 3): each selected sweep is
// replayed only from its painted span less the sweep's own lead-in to the
// painted span plus its own lead-out, with repeated G1 and S words left out.
// What burns must not change: every scenario is compared with writer 1 through
// the independent interpreter in program-oracle.test-helper.ts.

import { describe, expect, it } from 'vitest';
import { buildLaserSecondPassProgram } from './index';
import { simulateProgram } from './program-oracle.test-helper';
import type {
  LaserSecondPassSegment,
  LaserSecondPassSelection,
  LaserSecondPassStroke,
  LaserSecondPassWriterVersion,
} from './types';

const SOURCE =
  'G21\nG90\nG54\nG94\nM4 S0\nG0 X-5 Y0 S0\nG1 X0 F600 S0\nG1 X10 S200\nG1 X15 S0\nM5\n';
const PRELUDE = ['; KerfDesk selective second pass', 'G21', 'G90', 'G54', 'G94', 'G17', 'M5'];

function stroke(x: number, y: number, radiusMm: number, powerScale = 1): LaserSecondPassStroke {
  return { id: `${x},${y}`, points: [{ x, y }], radiusMm, powerScale, mode: 'paint' };
}

function selection(
  strokes: ReadonlyArray<LaserSecondPassStroke>,
  initialPosition?: { x: number; y: number },
): LaserSecondPassSelection {
  return {
    version: 1,
    maxPowerS: 1000,
    strokes,
    ...(initialPosition === undefined ? {} : { initialPosition }),
  };
}

function build(
  source: string,
  brush: LaserSecondPassSelection,
  writerVersion: LaserSecondPassWriterVersion = 2,
) {
  const result = buildLaserSecondPassProgram(source, brush, { writerVersion });
  expect(result.kind, result.kind === 'error' ? result.message : undefined).toBe('ready');
  if (result.kind !== 'ready') throw new Error(result.message);
  return result;
}

/** Burning motion with consecutive collinear equal-power moves joined, so a
 * burn written as one move or as several pieces compares equal. */
function burnCoverage(gcode: string): string[] {
  const joined: LaserSecondPassSegment[] = [];
  for (const move of simulateProgram(gcode)) {
    if (move.power <= 0) continue;
    const last = joined.at(-1);
    if (last !== undefined && continues(last, move)) {
      joined[joined.length - 1] = { ...last, to: move.to };
    } else joined.push(move);
  }
  const at = (value: number) => value.toFixed(9);
  return joined.map(
    (move) =>
      `${at(move.from.x)},${at(move.from.y)}>${at(move.to.x)},${at(move.to.y)} ` +
      `S${move.power} F${move.feed} M${move.mode}`,
  );
}

function continues(a: LaserSecondPassSegment, b: LaserSecondPassSegment): boolean {
  if (a.power !== b.power || a.feed !== b.feed || a.mode !== b.mode) return false;
  if (Math.abs(a.to.x - b.from.x) > 1e-9 || Math.abs(a.to.y - b.from.y) > 1e-9) return false;
  const ax = a.to.x - a.from.x;
  const ay = a.to.y - a.from.y;
  const bx = b.to.x - b.from.x;
  const by = b.to.y - b.from.y;
  return Math.abs(ax * by - ay * bx) <= 1e-9 * Math.hypot(ax, ay) * Math.hypot(bx, by);
}

/** Head travel after the first positioning move, whose start the interpreter
 * cannot know (it begins at the origin). */
function motionLengthMm(gcode: string): number {
  return simulateProgram(gcode)
    .slice(1)
    .reduce(
      (total, move) => total + Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y),
      0,
    );
}

/** Raster-style rows: dark lead-in, burn, dark lead-out, joined by dark feed row changes. */
function rasterRows(rows: number, widthMm: number, runwayMm: number): string {
  const lines = ['G21', 'G90', 'M4 S0'];
  for (let row = 0; row < rows; row += 1) {
    const reverse = row % 2 === 1;
    const start = reverse ? widthMm + runwayMm : -runwayMm;
    const end = reverse ? -runwayMm : widthMm + runwayMm;
    lines.push(`G1 X${start} Y${row} F1200 S0`, `G1 X${reverse ? widthMm : 0} S0`);
    for (let pixel = 1; pixel <= widthMm; pixel += 1) {
      const x = reverse ? widthMm - pixel : pixel;
      lines.push(`X${x}S${100 + ((row * 37 + pixel * 11) % 400)}`);
    }
    lines.push(`X${end} S0`);
  }
  lines.push('M5');
  return lines.join('\n');
}

describe('writer 2 replays each selected sweep only around its painted span', () => {
  it('starts one source lead-in before the first painted point and stops one lead-out after the last', () => {
    const result = build(SOURCE, selection([stroke(5, 0, 1)]));
    // Lead-in X-5..X0 and lead-out X10..X15 are 5 mm each; paint covers X4..X6.
    expect(result.gcode.split('\n')).toEqual([
      ...PRELUDE,
      'G0X-1Y0S0',
      'M4 S0',
      'G1X0F600',
      'X4',
      'X6S200',
      'X10S0',
      'X11',
      'M5',
      '',
    ]);
    expect(result.motionBounds).toEqual({ minX: -1, minY: 0, maxX: 11, maxY: 0 });
    expect(result.bounds).toEqual({ minX: 4, minY: 0, maxX: 6, maxY: 0 });
    expect(result.burnLengthMm).toBe(2);
  });

  it('keeps the whole approach on a side where the source sweep has no runway', () => {
    const source = 'G21\nG90\nM4 S0\nG0 X0 Y0 S0\nG1 X10 F600 S200\nG1 X15 S0\nM5\n';
    const result = build(source, selection([stroke(5, 0, 1)]));
    // No lead-in: the original reached X4 from rest at X0, so the pass does too.
    expect(result.gcode.split('\n')).toEqual([
      ...PRELUDE,
      'G0X0Y0S0',
      'M4 S0',
      'G1X4F600',
      'X6S200',
      'X10S0',
      'X11',
      'M5',
      '',
    ]);
  });

  it('keeps the whole sweep end when the source burns to its last point', () => {
    const source = 'G21\nG90\nM4 S0\nG0 X-5 Y0 S0\nG1 X0 F600 S0\nG1 X10 S200\nM5\n';
    const result = build(source, selection([stroke(5, 0, 1)]));
    expect(result.motionBounds).toEqual({ minX: -1, minY: 0, maxX: 10, maxY: 0 });
  });

  it('trims a reversed controlled-dark raster row without introducing a rapid', () => {
    const rows = ['G21', 'G90', 'M4 S0'];
    for (let row = 0; row < 6; row += 1) {
      const reverse = row % 2 === 1;
      rows.push(
        `G1 X${reverse ? 12 : -2} Y${row} F600 S0`,
        `G1 X${reverse ? 10 : 0} S0`,
        `X${reverse ? 0 : 10} S200`,
        `X${reverse ? -2 : 12} S0`,
      );
    }
    rows.push('M5');
    const result = build(rows.join('\n'), selection([stroke(5, 3, 1)]));
    expect(result.gcode.split('\n')).toEqual([
      ...PRELUDE,
      'G1X8Y3F600S0',
      'M4 S0',
      'X6F600',
      'X4S200',
      'X2S0',
      'M5',
      '',
    ]);
  });

  it('writes a painted spot on a wide row in a fraction of writer 1 motion', () => {
    const source = rasterRows(3, 80, 5);
    // One row only: the neighbouring rows lie 1 mm away, outside the brush.
    const brush = selection([stroke(40, 1, 0.4)]);
    const whole = build(source, brush, 1);
    const trimmed = build(source, brush, 2);
    expect(burnCoverage(trimmed.gcode)).toEqual(burnCoverage(whole.gcode));
    // Writer 1 replays the whole 90 mm sweep; writer 2 the 0.8 mm spot plus
    // the row's own 5 mm runway on each side.
    expect(motionLengthMm(whole.gcode)).toBeCloseTo(90, 9);
    expect(motionLengthMm(trimmed.gcode)).toBeCloseTo(10.8, 9);
    expect(trimmed.gcode.length).toBeLessThan(0.25 * whole.gcode.length);
  });

  it('writes no longer than the compact source for the rows it replays', () => {
    const source = rasterRows(4, 30, 3);
    // Paint every burn so both writers replay every row end to end.
    const brush = selection([{ ...stroke(15, 1.5, 40), points: [{ x: 15, y: 1.5 }] }]);
    const whole = build(source, brush, 1);
    const compact = build(source, brush, 2);
    expect(burnCoverage(compact.gcode)).toEqual(burnCoverage(whole.gcode));
    expect(compact.gcode.length).toBeLessThanOrEqual(source.length + 64);
    expect(compact.gcode.length).toBeLessThan(0.9 * whole.gcode.length);
  });

  it('never repeats the modal motion word or power value on a burning sweep', () => {
    const brush = selection([stroke(10, 2, 3), stroke(22, 0, 3)]);
    expect(repeatedModalWords(build(rasterRows(4, 30, 3), brush).gcode)).toEqual([]);
    // The check itself catches repetition: writer 1 restates G1 on every line.
    expect(repeatedModalWords(build(rasterRows(4, 30, 3), brush, 1).gcode).length).toBeGreaterThan(
      10,
    );
  });
});

/** Movement lines that restate the modal G1 or the modal S value. Positioning
 * lines and beam arming state them on purpose. */
function repeatedModalWords(gcode: string): string[] {
  const repeated: string[] = [];
  const modal = { motion: '', power: '' };
  for (const line of gcode.split('\n')) {
    const words = modalWords(line);
    const restated =
      (words.motion !== '' && words.motion === modal.motion) ||
      (words.power !== '' && words.power === modal.power);
    if (restated && !statesWordsOnPurpose(line)) repeated.push(line);
    if (words.motion !== '') modal.motion = words.motion;
    if (words.power !== '') modal.power = words.power;
  }
  return repeated;
}

/** The motion word and trailing S value a line states; beam arming states S0. */
function modalWords(line: string): { readonly motion: string; readonly power: string } {
  if (line.startsWith('M')) return { motion: '', power: /^M[34] S0$/.test(line) ? '0' : '' };
  return {
    motion: /^(G[01])(?!\d)/.exec(line)?.[1] ?? '',
    power: /S([-\d.]+)$/.exec(line)?.[1] ?? '',
  };
}

/** Beam words and dark positioning (G0, or a feed entry written with F and S0)
 * state their words on purpose. */
function statesWordsOnPurpose(line: string): boolean {
  return line.startsWith('M') || line.startsWith('G0') || /^G1X[^S]*F[^S]*S0$/.test(line);
}

describe('writer 2 burns exactly what writer 1 burns', () => {
  const MIXED = `${SOURCE.replace('M5\n', '')}G0 X15 Y3 S0\nM3 S0\nG1 X10 F800 S0\nX0 S400\nX-5 S0\nM5\n`;
  const TONES = SOURCE.replace('G1 X10 S200', 'G1 X3 S100\nX4 S0\nX7 S600\nX10 S250');
  const cases: ReadonlyArray<readonly [string, string, LaserSecondPassSelection]> = [
    ['a scaled chord', SOURCE, selection([stroke(5, 0, 1, 0.5)])],
    [
      'overlapping strokes with erase and repaint',
      SOURCE,
      selection([
        stroke(5, 0, 4),
        stroke(5, 0, 2, 0.5),
        { ...stroke(5, 0, 1), mode: 'erase' },
        stroke(5, 0, 0.25, 2),
      ]),
    ],
    ['tones with white gaps and clipping', TONES, selection([stroke(5, 0, 20, 2)])],
    ['two beam modes on two rows', MIXED, selection([stroke(5, 0, 1), stroke(5, 3, 1)])],
    ['a repeated program', SOURCE + SOURCE, selection([stroke(5, 0, 1)])],
    ['air assist between sweeps', `M8\n${SOURCE}${SOURCE}`, selection([stroke(5, 0, 1)])],
    [
      'a relative source',
      'G21\nG91\nM4S0\nG1X10F300S200\nM5\n',
      selection([stroke(25, 30, 1)], { x: 20, y: 30 }),
    ],
    [
      'inch units',
      'G20 G90\nM4 S0\nG0 X1 Y2\nG91\nG1 X1 F2 S200\nM5\n',
      selection([stroke(38.1, 50.8, 2.54)]),
    ],
    [
      'a diagonal runway',
      'G21\nG90\nM4 S0\nG0 X9.292 Y9.293 S0\nG1 X10 Y10 F600 S0\nX20 Y20 S300\nM5\n',
      selection([stroke(15, 15, 1)]),
    ],
    ['a dense raster', rasterRows(6, 40, 4), selection([stroke(7, 2, 1.5), stroke(33, 4, 3, 0.7)])],
  ];

  it.each(cases)('%s', (_name, source, brush) => {
    const whole = build(source, brush, 1);
    const trimmed = build(source, brush, 2);
    expect(burnCoverage(trimmed.gcode)).toEqual(burnCoverage(whole.gcode));
    expect(trimmed.bounds).toEqual(whole.bounds);
    expect(trimmed.clamped).toBe(whole.clamped);
    expect(trimmed.burnLengthMm).toBeCloseTo(whole.burnLengthMm, 9);
    expect(motionLengthMm(trimmed.gcode)).toBeLessThanOrEqual(motionLengthMm(whole.gcode) + 1e-9);
  });

  it('keeps writer 1 as the replay path for stages saved without a writer', () => {
    const brush = selection([stroke(5, 0, 1)]);
    expect(buildLaserSecondPassProgram(SOURCE, brush, { writerVersion: 1 })).toEqual(
      buildLaserSecondPassProgram(SOURCE, brush, { writerVersion: 1 }),
    );
    expect(build(SOURCE, brush, 1).gcode).toContain('G1X10S0');
    expect(build(SOURCE, brush, 1).gcode).toContain('G1X15S0');
    expect(build(SOURCE, brush).gcode).toBe(build(SOURCE, brush, 2).gcode);
  });
});
