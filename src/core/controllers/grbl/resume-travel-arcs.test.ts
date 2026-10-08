// ADR-341 Amendment 8 calls this path travel. Analytical quarter circles
// distinguish their length from endpoint chords without sharing arc math.
import { describe, expect, it } from 'vitest';
import {
  LASER_RESUME_TRANSFORM_VERSION,
  buildResumeProgram,
  resumeEntryPointMm,
  resumeTravelMm,
} from './resume-program';

const QUARTER_PAIR = [
  'G21 G90 G54 G17',
  'M4 S0',
  'M8',
  'G0 X10 Y20 S0',
  'G2 X20 Y30 I10 J0 F1500 S500',
  'G2 X30 Y20 I0 J-10',
  'M5',
].join('\n');

const quarterFixtures = [
  { units: 'millimetres', gUnits: 'G21', radius: 10, scale: 1 },
  { units: 'inches', gUnits: 'G20', radius: 1, scale: 25.4 },
].flatMap((unit) =>
  [true, false].flatMap((clockwise) =>
    ['IJ', 'R'].map((form) => {
      const r = unit.radius;
      const firstY = clockwise ? 3 * r : r;
      const secondJ = clockwise ? -r : r;
      const firstGeometry = form === 'IJ' ? `I${r} J0` : `R${r}`;
      const secondGeometry = form === 'IJ' ? `I0 J${secondJ}` : `R${r}`;
      return {
        name: `${clockwise ? 'CW G2' : 'CCW G3'}, ${form}, ${unit.units}`,
        radiusMm: r * unit.scale,
        program: [
          `${unit.gUnits} G90 G54 G17 G91.1`,
          `G0 X${r} Y${2 * r} S0`,
          `${clockwise ? 'G2' : 'G3'} X${2 * r} Y${firstY} ${firstGeometry} F60 S100`,
          // G2/G3 is modal; the center/radius words remain per-block.
          `X${3 * r} Y${2 * r} ${secondGeometry}`,
          'M5',
        ].join('\n'),
      };
    }),
  ),
);

describe('R1 arc-aware recovery XY travel', () => {
  it('counts two supported radius-10 quarter arcs as 31.4159265359 mm rather than 28.2842712475 mm of chords', () => {
    const analyticalPath = 10 * Math.PI;
    const endpointChords = 20 * Math.SQRT2;
    expect(analyticalPath).toBeCloseTo(31.4159265359, 9);
    expect(endpointChords).toBeCloseTo(28.2842712475, 9);
    expect(resumeTravelMm(QUARTER_PAIR, 5, 7)).toBeCloseTo(analyticalPath, 9);
  });

  it.each(quarterFixtures)('follows native modal quarter arcs: $name', ({ program, radiusMm }) => {
    expect(resumeTravelMm(program, 3, 5)).toBeCloseTo(radiusMm * Math.PI, 9);
    // Starting inside an existing modal arc program must retain its direction.
    expect(resumeTravelMm(program, 4, 5)).toBeCloseTo((radiusMm * Math.PI) / 2, 9);
  });

  it('follows a G2-to-G3 direction change using the newly selected arc mode', () => {
    const program = [
      'G21 G90 G54 G17',
      'G0 X10 Y20',
      'G2 X20 Y30 I10 J0 F1500 S500',
      'G3 X10 Y20 I0 J-10',
      'M5',
    ].join('\n');
    expect(resumeTravelMm(program, 3, 5)).toBeCloseTo(10 * Math.PI, 9);
    expect(resumeTravelMm(program, 4, 5)).toBeCloseTo(5 * Math.PI, 9);
  });

  it('counts a valid XY arc when the program relies on the default G17 plane', () => {
    const program = 'G21 G90 G54\nG0 X10 Y20\nG2 X20 Y30 I10 J0\nM5';
    expect(resumeTravelMm(program, 3, 4)).toBeCloseTo(5 * Math.PI, 9);
  });

  it('reads arc words independently of their order inside a valid block', () => {
    const program = 'G21 G90 G54 G17\nG0 X10 Y20\nI10 X20 F1000 J0 Y30 G2 S500\nM5';
    expect(resumeTravelMm(program, 3, 4)).toBeCloseTo(5 * Math.PI, 9);
  });

  it('returns to linear/modal linear and rapid distances after an arc', () => {
    const program = [
      'G21 G90 G54 G17',
      'G0 X10 Y20',
      'G2 X20 Y30 I10 J0 F1500 S500',
      'G1 X25 Y30',
      'Y35',
      'G0 X28 Y39 S0',
      'M5',
    ].join('\n');
    expect(resumeTravelMm(program, 3, 7)).toBeCloseTo(5 * Math.PI + 5 + 5 + 5, 9);
    // The post-arc linear suffix is itself a passing pre-fix control.
    expect(resumeTravelMm(program, 4, 7)).toBeCloseTo(15, 9);
  });

  it.each([
    { name: 'bare arc selectors', blocks: ['G2', 'G3'] },
    { name: 'bare linear selectors', blocks: ['G0', 'G1'] },
    {
      name: 'comments, blank lines, and percent delimiter',
      blocks: ['', '; G2 X10 Y20 I10 J0', '(G3 X10 Y20 I10 J0)', '%'],
    },
    { name: 'feed and beam words', blocks: ['F900', 'S0', 'M4 S0', 'M5'] },
    { name: 'coolant words', blocks: ['M7', 'M8', 'M9'] },
    { name: 'dwell', blocks: ['G4 P2'] },
    { name: 'plane/feed-mode and planner controls', blocks: ['G17', 'G94', 'M400'] },
  ])('control: $name after an arc are not additional movement', ({ blocks }) => {
    const program = [
      'G21 G90 G54 G17',
      'G0 X10 Y20',
      'G2 X20 Y30 I10 J0 F1500 S500',
      ...blocks,
      'M5',
    ].join('\n');
    expect(resumeTravelMm(program, 4, program.split('\n').length + 1)).toBe(0);
    expect(resumeEntryPointMm(program, program.split('\n').length + 1)).toEqual({ x: 20, y: 30 });
  });

  it('control: a bare G1 after an arc changes the next endpoint block to linear motion', () => {
    const program = 'G21 G90 G54 G17\nG0 X10 Y20\nG2 X20 Y30 I10 J0\nG1\nX25 Y30\nM5';
    expect(resumeTravelMm(program, 4, 6)).toBe(5);
  });

  it.each([
    { name: 'arc has no I/J or R geometry', block: 'G2 X20 Y30' },
    { name: 'I/J radius is zero', block: 'G2 X20 Y30 I0 J0' },
    { name: 'I/J endpoint radius does not match the start radius', block: 'G2 X20 Y30 I5 J0' },
    { name: 'R cannot span the commanded chord', block: 'G2 X20 Y30 R1' },
    { name: 'R is zero', block: 'G2 X20 Y30 R0' },
    { name: 'R cannot describe a same-point arc', block: 'G2 X10 Y20 R10' },
    // These are deliberately unsupported diagnostic inputs, not app-emitted
    // arcs. Unknown XY geometry must not be reported as a truthful chord.
    { name: 'XZ-plane arc', block: 'G18 G2 X20 Y30 I10 K0' },
    { name: 'YZ-plane arc', block: 'G19 G3 X20 Y30 J10 K0' },
    { name: 'absolute arc-center mode is not tracked', block: 'G90.1 G2 X20 Y30 I20 J20' },
  ])('returns unknown travel for invalid or untracked geometry: $name', ({ block }) => {
    const program = `G21 G90 G54 G17\nG0 X10 Y20\n${block}\nM5`;
    expect(resumeTravelMm(program, 3, 4)).toBeNull();
  });

  it('does not reuse I/J from the previous block when a modal arc omits its own geometry', () => {
    const program = 'G21 G90 G54 G17\nG0 X10 Y20\nG2 X20 Y30 I10 J0\nX30 Y20\nM5';
    expect(resumeTravelMm(program, 4, 5)).toBeNull();
  });

  it('returns unknown for an arc whose starting XY point is incomplete', () => {
    const program = 'G21 G90 G54 G17\nG0 X10\nG2 X20 Y30 I10 J0\nM5';
    expect(resumeTravelMm(program, 3, 4)).toBeNull();
  });

  it('control: strict malformed-word, unit-change, and non-G54 qualification remain unchanged', () => {
    const malformed = 'G21 G90 G54 G17\nG0 X10 Y20\nG2 X.5 Y30 I10 J0\nM5';
    const unitChange = 'G21 G90 G54 G17\nG0 X10 Y20\nG20\nG2 X2 Y3 I1 J0\nM5';
    const otherWcs = 'G21 G90 G55 G17\nG0 X10 Y20\nG2 X20 Y30 I10 J0\nM5';
    expect(resumeTravelMm(malformed, 3, 4)).toBeNull();
    expect(resumeTravelMm(unitChange, 3, 5)).toBeNull();
    expect(resumeTravelMm(otherWcs, 3, 4)).toBeNull();
  });

  it.each([1, 2, 3, 4] as const)(
    'control: distance inspection preserves exact transform-%s re-entry bytes and endpoint',
    (laserTransform) => {
      const options = {
        machineKind: 'laser' as const,
        safeZMm: 0,
        spindleSpinupSec: 0,
        plungeMmPerMin: 300,
        laserTransform,
      };
      const before = buildResumeProgram(QUARTER_PAIR, 6, options);
      if (before.kind !== 'ok') throw new Error(before.reason);
      const expectedPreamble = [
        '; KerfDesk resume preamble',
        'G21',
        'G90',
        'G54',
        'G94',
        ...(laserTransform === 4 ? ['G17'] : []),
        'M5',
        ...(laserTransform >= 2 ? ['M8'] : []),
        'G0 X20 Y30 S0',
        'M4 S0',
        'F1500',
      ];
      expect(before.lines).toEqual([...expectedPreamble, 'G2 X30 Y20 I0 J-10 S500', 'M5']);
      expect(before.preambleCount).toBe(expectedPreamble.length);
      expect(resumeEntryPointMm(QUARTER_PAIR, 5)).toEqual({ x: 10, y: 20 });
      expect(resumeEntryPointMm(QUARTER_PAIR, 6)).toEqual({ x: 20, y: 30 });
      expect(resumeEntryPointMm(QUARTER_PAIR, 7)).toEqual({ x: 30, y: 20 });
      resumeTravelMm(QUARTER_PAIR, 5, 7);
      expect(buildResumeProgram(QUARTER_PAIR, 6, options)).toEqual(before);
      expect(LASER_RESUME_TRANSFORM_VERSION).toBe(4);
    },
  );
});
