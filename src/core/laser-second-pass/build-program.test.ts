import { describe, expect, it } from 'vitest';
import { buildLaserSecondPassProgram, parseLaserSecondPassSource } from './index';
import { simulateProgram } from './program-oracle.test-helper';
import { decimal } from './program-writer';
import type { LaserSecondPassSelection, LaserSecondPassStroke } from './types';

const SOURCE =
  'G21\nG90\nG54\nG94\nM4 S0\nG0 X-5 Y0 S0\nG1 X0 F600 S0\nG1 X10 S200\nG1 X15 S0\nM5\n';

function stroke(
  x: number,
  radiusMm: number,
  powerScale = 1,
  mode: 'paint' | 'erase' = 'paint',
): LaserSecondPassStroke {
  return { id: 'stroke', points: [{ x, y: 0 }], radiusMm, powerScale, mode };
}

function selection(strokes: ReadonlyArray<LaserSecondPassStroke>): LaserSecondPassSelection {
  return { version: 1, maxPowerS: 1000, strokes };
}

function ready(source: string, brush: LaserSecondPassSelection) {
  const result = buildLaserSecondPassProgram(source, brush);
  expect(result.kind, result.kind === 'error' ? result.message : undefined).toBe('ready');
  if (result.kind !== 'ready') throw new Error(result.message);
  return result;
}

describe('selective pass construction', () => {
  it('clips at the exact painted chord and preserves dark entry/exit runways', () => {
    const result = ready(SOURCE, selection([stroke(5, 1, 0.5)]));
    const motions = simulateProgram(result.gcode);
    expect(motions.filter((motion) => motion.power > 0)).toEqual([
      { from: { x: 4, y: 0 }, to: { x: 6, y: 0 }, feed: 600, power: 100, mode: 4, rapid: false },
    ]);
    expect(motions.at(-1)?.to).toEqual({ x: 15, y: 0 });
    expect(result.bounds).toEqual({ minX: 4, minY: 0, maxX: 6, maxY: 0 });
    expect(result.motionBounds).toEqual({ minX: -5, minY: 0, maxX: 15, maxY: 0 });
    expect(result.burnLengthMm).toBe(2);
    expect(result.gcode.endsWith('M5\n')).toBe(true);
  });

  it('traverses overlaps once while applying each last covering power, erase, and repaint', () => {
    const result = ready(
      SOURCE,
      selection([stroke(5, 4), stroke(5, 2, 0.5), stroke(5, 1, 1, 'erase'), stroke(5, 0.25, 2)]),
    );
    const burn = simulateProgram(result.gcode).filter((motion) => motion.power > 0);
    expect(burn.map((motion) => [motion.from.x, motion.to.x, motion.power])).toEqual([
      [1, 3, 200],
      [3, 4, 100],
      [4.75, 5.25, 400],
      [6, 7, 100],
      [7, 9, 200],
    ]);
    expect(result.burnLengthMm).toBe(6.5);
  });

  it('scales original tones, preserves white gaps, and reports clipping at maximum S', () => {
    const source = SOURCE.replace('G1 X10 S200', 'G1 X3 S100\nX4 S0\nX7 S600\nX10 S250');
    const result = ready(source, selection([stroke(5, 20, 2)]));
    const burn = simulateProgram(result.gcode).filter((motion) => motion.power > 0);
    expect(burn.map((motion) => [motion.from.x, motion.to.x, motion.power])).toEqual([
      [0, 3, 200],
      [4, 7, 1000],
      [7, 10, 500],
    ]);
    expect(result.clamped).toBe(true);
    expect(result.burnLengthMm).toBe(9);
  });

  it('does not introduce rapid moves into a controlled-dark G1 source', () => {
    const source = SOURCE.replace('G0 X-5 Y0 S0', 'G1 X-5 Y0 F800 S0');
    const result = ready(source, selection([stroke(5, 1)]));
    expect(result.gcode).not.toMatch(/^G0/m);
    expect(result.gcode).toContain('G1X-5Y0F800S0');
    expect(simulateProgram(result.gcode).find((move) => move.power > 0)?.feed).toBe(600);
  });

  it('omits unpainted rows and retains the selected reverse row direction and beam mode', () => {
    const source = `${SOURCE.replace('M5\n', '')}G0 X15 Y3 S0\nM3 S0\nG1 X10 F800 S0\nX0 S400\nX-5 S0\nM5\n`;
    const brush = selection([{ ...stroke(5, 1), points: [{ x: 5, y: 3 }] }]);
    const result = ready(source, brush);
    const burn = simulateProgram(result.gcode).filter((motion) => motion.power > 0);
    expect(burn).toEqual([
      { from: { x: 6, y: 3 }, to: { x: 4, y: 3 }, feed: 800, power: 400, mode: 3, rapid: false },
    ]);
    expect(result.motionBounds).toEqual({ minX: -5, minY: 3, maxX: 15, maxY: 3 });
  });

  it('retains original multiple passes without multiplying overlapping brush marks', () => {
    const brush = selection([stroke(5, 1), stroke(5, 1), stroke(5, 1)]);
    const result = ready(SOURCE + SOURCE, brush);
    expect(simulateProgram(result.gcode).filter((motion) => motion.power > 0)).toHaveLength(2);
    expect(result.burnLengthMm).toBe(4);
  });

  it('keeps air running between selected sweeps and turns it off at the end', () => {
    const source = `M8\n${SOURCE}${SOURCE}`;
    const result = ready(source, selection([stroke(5, 1)]));
    expect(result.gcode.split('\n').filter((line) => /^M[789]$/.test(line))).toEqual(['M8', 'M9']);
  });

  it('supports inch and relative modal source in absolute mm output', () => {
    const source = 'G20 G90\nM4 S0\nG0 X1 Y2\nG91\nG1 X1 F2 S200\nM5\n';
    const brush = selection([{ ...stroke(38.1, 2.54), points: [{ x: 38.1, y: 50.8 }] }]);
    const result = ready(source, brush);
    const burn = simulateProgram(result.gcode).filter((motion) => motion.power > 0);
    expect(burn).toHaveLength(1);
    expect(burn[0]?.from.x).toBeCloseTo(35.56, 12);
    expect(burn[0]?.to.x).toBeCloseTo(40.64, 12);
    expect(burn[0]?.feed).toBe(50.8);
    expect(burn[0]?.from.y).toBe(50.8);
    expect(result.burnLengthMm).toBeCloseTo(5.08, 12);
    expect(result.gcode).not.toContain('G91');
  });

  it('uses a supplied original work position for a source beginning relatively', () => {
    const source = 'G21\nG91\nM4S0\nG1X10F300S200\nM5\n';
    const brush = {
      ...selection([{ ...stroke(25, 1), points: [{ x: 25, y: 30 }] }]),
      initialPosition: { x: 20, y: 30 },
    };
    const result = ready(source, brush);
    expect(result.bounds).toEqual({ minX: 24, minY: 30, maxX: 26, maxY: 30 });
  });

  it('is deterministic and leaves source selection data unchanged', () => {
    const brush = selection([stroke(5, 2.1), stroke(5.1, 0.3, 0.87)]);
    const before = JSON.stringify(brush);
    expect(ready(SOURCE, brush)).toEqual(ready(SOURCE, brush));
    expect(JSON.stringify(brush)).toBe(before);
  });

  it('handles small finite values without exponent notation and avoids multiplier overflow', () => {
    for (const number of [1e-12, -5e-9, 1e21, -1.345678e22, Number.MIN_VALUE, -0]) {
      expect(decimal(number)).not.toMatch(/[eE]/);
      expect(Number(decimal(number))).toBe(number === 0 ? 0 : number);
    }
    const result = ready(SOURCE, selection([stroke(5, 1, Number.MAX_VALUE)]));
    expect(result.clamped).toBe(true);
    expect(simulateProgram(result.gcode).find((motion) => motion.power > 0)?.power).toBe(1000);
  });
});

describe('explicit unsupported or empty selective output', () => {
  it.each([
    'G2 X10 I5',
    'G3 X10 R5',
    'G4 P1',
    'G92 X0',
    'G53 G0 X1',
    'G55',
    'G93',
    'G18',
    'G1 Z1',
    'G1 A10',
    'M0',
    '$H',
    '/G1X10',
    'N1G1X10*25',
    'X10junk',
    'G0 G1 X10',
  ])('rejects executable semantics it cannot preserve: %s', (line) => {
    const result = buildLaserSecondPassProgram(`${SOURCE}${line}\n`, selection([stroke(5, 1)]));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toContain('Source line');
  });

  it.each([
    'G21\nG90\nM4 S0\nG1 X10 Y0 F100 S100\n',
    'G21\nG91\nM4 S0\nG1 X10 F100 S100\n',
    'G21\nG0 X0 Y0\nM4S0\nG1X10S100\n',
    'G21\nG0 X0 Y0\nM3S100\nG1X10F100\n',
    'G21\nG0 X0 Y0\nM4S0\nG1X0F100S100\n',
    `${SOURCE}M2\nG1X20\n`,
  ])(
    'does not invent initial position, feed, stationary burns, or motion after program end',
    (source) => {
      expect(buildLaserSecondPassProgram(source, selection([stroke(5, 1)])).kind).toBe('error');
    },
  );

  it.each(
    [[], [stroke(5, 1, 0)], [stroke(5, 1), stroke(5, 2, 1, 'erase')], [stroke(100, 1)]].map(
      (strokes) => ({ strokes }),
    ),
  )('explains a selection with no remaining original burn', ({ strokes }) => {
    expect(buildLaserSecondPassProgram(SOURCE, selection(strokes))).toEqual({
      kind: 'error',
      message: 'Paint an area that crosses an engraved part of this job.',
    });
  });

  it.each([0, -1, NaN, Infinity])('rejects an invalid maximum S value %s', (maxPowerS) => {
    expect(
      buildLaserSecondPassProgram(SOURCE, { ...selection([stroke(5, 1)]), maxPowerS }).kind,
    ).toBe('error');
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid brush radius %s', (radius) => {
    expect(buildLaserSecondPassProgram(SOURCE, selection([stroke(5, radius)])).kind).toBe('error');
  });

  it('shares strict source semantics with the preview and ignores comment instructions', () => {
    const source = `${SOURCE}; G92 X1000 M3 S1000 is a comment\n( G2 X999 )\n`;
    const parsed = parseLaserSecondPassSource(source);
    expect(parsed.kind).toBe('ready');
    if (parsed.kind === 'ready')
      expect(parsed.segments.filter((motion) => motion.power > 0)).toHaveLength(1);
    expect(parseLaserSecondPassSource(`${source}G2 X10 I5`).kind).toBe('error');
  });
});
