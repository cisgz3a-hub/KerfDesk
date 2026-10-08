// R1 external distance-qualification fixtures, not claims that these blocks
// are app-emitted or safe to send. Ordinary emitter reachability is tested in
// resume-travel-native-arcs.test.ts. Expected lengths here use analytic arcs.
import { describe, expect, it } from 'vitest';
import { resumeEntryPointMm, resumeTravelMm } from './resume-program';

const DIRECTIONS = [
  { name: 'CW', motion: 'G2', clockwise: true },
  { name: 'CCW', motion: 'G3', clockwise: false },
] as const;
const UNITS = [
  { name: 'mm', word: 'G21', radius: 10, scale: 1 },
  { name: 'inches', word: 'G20', radius: 1, scale: 25.4 },
] as const;

function knownPointProgram(blocks: ReadonlyArray<string>, units = 'G21', x = 10, y = 20): string {
  return [`${units} G90 G54 G17`, `G0 X${x} Y${y}`, ...blocks, 'M5'].join('\n');
}

const majorFixtures = DIRECTIONS.flatMap((direction) =>
  UNITS.map((unit) => ({
    name: `${direction.name}, ${unit.name}`,
    radiusMm: unit.radius * unit.scale,
    program: knownPointProgram(
      [
        `${direction.motion} X${2 * unit.radius} Y${direction.clockwise ? 3 * unit.radius : unit.radius} R${-unit.radius}`,
      ],
      unit.word,
      unit.radius,
      2 * unit.radius,
    ),
  })),
);

const circleFixtures = DIRECTIONS.flatMap((direction) =>
  UNITS.flatMap((unit) =>
    ['I', 'J'].flatMap((centerAxis) =>
      [true, false].map((explicitEndpoint) => ({
        name: `${direction.name}, ${unit.name}, ${centerAxis}-only, ${explicitEndpoint ? 'same XY' : 'no XY words'}`,
        radiusMm: unit.radius * unit.scale,
        point: { x: unit.radius * unit.scale, y: 2 * unit.radius * unit.scale },
        program: knownPointProgram(
          [
            `${direction.motion}${explicitEndpoint ? ` X${unit.radius} Y${2 * unit.radius}` : ''} ${centerAxis}${unit.radius}`,
          ],
          unit.word,
          unit.radius,
          2 * unit.radius,
        ),
      })),
    ),
  ),
);

describe('R1 arc travel geometry boundaries', () => {
  it.each(majorFixtures)(
    'counts a signed-R major arc as three quarters of a circle: $name',
    ({ program, radiusMm }) => {
      // The endpoints subtend 90 degrees on the minor circle. Negative R
      // selects the complementary 270 degrees in either motion direction.
      expect(resumeTravelMm(program, 3, 4)).toBeCloseTo((3 * Math.PI * radiusMm) / 2, 9);
    },
  );

  it.each(circleFixtures)(
    'counts a nonzero I/J full circle and preserves its endpoint: $name',
    ({ program, radiusMm, point }) => {
      expect(resumeEntryPointMm(program, 3)).toEqual(point);
      expect(resumeEntryPointMm(program, 4)).toEqual(point);
      expect(resumeTravelMm(program, 3, 4)).toBeCloseTo(2 * Math.PI * radiusMm, 9);
    },
  );

  it.each(DIRECTIONS)(
    'counts center-only modal full-circle geometry after a bare selector: $name',
    ({ motion }) => {
      const program = knownPointProgram([motion, 'I10 J0']);
      expect(resumeTravelMm(program, 3, 5)).toBeCloseTo(20 * Math.PI, 9);
    },
  );

  it.each([
    { name: 'CW, X only', block: 'G2 X20 I5 J-5', endpoint: { x: 20, y: 20 } },
    { name: 'CCW, X only', block: 'G3 X20 I5 J5', endpoint: { x: 20, y: 20 } },
    { name: 'CW, Y only', block: 'G2 Y30 I5 J5', endpoint: { x: 10, y: 30 } },
    { name: 'CCW, Y only', block: 'G3 Y30 I-5 J5', endpoint: { x: 10, y: 30 } },
  ])('retains the omitted endpoint axis for a quarter arc: $name', ({ block, endpoint }) => {
    const program = knownPointProgram([block]);
    // A diagonal center offset (5,5) gives radius sqrt(50), with a 90-degree sweep.
    expect(resumeEntryPointMm(program, 4)).toEqual(endpoint);
    expect(resumeTravelMm(program, 3, 4)).toBeCloseTo((5 * Math.SQRT2 * Math.PI) / 2, 9);
  });

  it.each([
    { name: 'CW, I only', block: 'G2 X20 Y30 I10', startX: 10 },
    { name: 'CCW, I only', block: 'G3 X20 Y10 I10', startX: 10 },
    { name: 'CW, J only', block: 'G2 X10 Y30 J10', startX: 20 },
    { name: 'CCW, J only', block: 'G3 X30 Y30 J10', startX: 20 },
  ])('uses zero for the omitted center offset of a quarter arc: $name', ({ block, startX }) => {
    const program = knownPointProgram([block], 'G21', startX, 20);
    expect(resumeTravelMm(program, 3, 4)).toBeCloseTo(5 * Math.PI, 9);
  });

  it.each([
    { name: 'selected before the counted span', fromLine: 4 },
    { name: 'selected inside the counted span', fromLine: 3 },
  ])('returns unknown for an untracked absolute center mode: $name', ({ fromLine }) => {
    const program = knownPointProgram(['G90.1', 'G2 X20 Y30 I20 J20']);
    expect(resumeTravelMm(program, fromLine, 5)).toBeNull();
  });

  it.each([
    { name: 'restored before the counted span', fromLine: 5 },
    { name: 'restored inside the counted span', fromLine: 3 },
  ])('uses incremental centers after G91.1 restores the mode: $name', ({ fromLine }) => {
    const program = knownPointProgram(['G90.1', 'G91.1', 'G2 X20 Y30 I10 J0']);
    expect(resumeTravelMm(program, fromLine, 6)).toBeCloseTo(5 * Math.PI, 9);
  });

  it.each([
    { name: 'agreeing center/radius forms', block: 'G2 X20 Y30 I10 J0 R10' },
    { name: 'disagreeing center/radius forms', block: 'G3 X20 Y10 I10 R-10' },
  ])('returns unknown for ambiguous mixed I/J and R geometry: $name', ({ block }) => {
    // The preview parser prioritises I/J, but that is not a validity guarantee
    // for a mixed-form controller block. This distance-only contract is
    // conservative; it must not change archived resume bytes or that parser.
    expect(resumeTravelMm(knownPointProgram([block]), 3, 4)).toBeNull();
  });

  const overflowWord = '9'.repeat(400);
  const finiteRadiusWithOverflowingSquare = `1${'0'.repeat(200)}`;
  it.each([
    { name: 'nonfinite endpoint', block: `G2 X${overflowWord} Y30 I10 J0` },
    { name: 'nonfinite I offset', block: `G2 X20 Y30 I${overflowWord} J0` },
    { name: 'nonfinite R', block: `G2 X20 Y30 R${overflowWord}` },
    {
      name: 'finite R whose center calculation overflows',
      block: `G2 X20 Y30 R${finiteRadiusWithOverflowingSquare}`,
    },
  ])('returns unknown for nonfinite arc arithmetic: $name', ({ block }) => {
    expect(resumeTravelMm(knownPointProgram([block]), 3, 4)).toBeNull();
  });

  it('returns unknown if individually finite full-circle lengths overflow their sum', () => {
    const radius = `1${'0'.repeat(307)}`;
    expect(Number.isFinite(2 * Math.PI * Number(radius))).toBe(true);
    expect(Number.isFinite(3 * 2 * Math.PI * Number(radius))).toBe(false);
    const program = knownPointProgram(Array.from({ length: 3 }, () => `G2 I${radius}`));
    expect(resumeTravelMm(program, 3, 6)).toBeNull();
  });

  it.each([
    { name: 'negative R smaller than its half chord', block: 'G2 X20 Y30 R-1' },
    { name: 'positive R just below a semicircle radius', block: 'G3 X20 Y20 R4.999' },
    { name: 'negative R just below a semicircle radius', block: 'G2 X20 Y20 R-4.999' },
    { name: 'R-only positive same-point geometry', block: 'G2 R10' },
    { name: 'R-only negative same-point geometry', block: 'G3 R-10' },
  ])('returns unknown when R cannot describe the arc: $name', ({ block }) => {
    expect(resumeTravelMm(knownPointProgram([block]), 3, 4)).toBeNull();
  });

  it.each([
    { name: 'Y has never been commanded', start: 'G0 X10', block: 'G2 I10' },
    { name: 'X has never been commanded', start: 'G0 Y20', block: 'G3 J10' },
  ])('cannot infer a full circle from incomplete starting XY: $name', ({ start, block }) => {
    const program = ['G21 G90 G54 G17', start, block, 'M5'].join('\n');
    expect(resumeTravelMm(program, 3, 4)).toBeNull();
  });

  it.each([
    { name: 'bare G2 selector', block: 'G2' },
    { name: 'bare G3 selector', block: 'G3' },
    { name: 'feed and beam words only', block: 'F900 S0' },
    { name: 'planner barrier', block: 'M400' },
    { name: 'dwell', block: 'G4 P2' },
  ])('control: $name after a full circle is not another full circle', ({ block }) => {
    const program = knownPointProgram(['G2 X10 Y20 I10', block]);
    expect(resumeTravelMm(program, 4, 5)).toBe(0);
    expect(resumeEntryPointMm(program, 5)).toEqual({ x: 10, y: 20 });
  });

  it('control: center-mode selectors without counted arc geometry add no travel', () => {
    const program = knownPointProgram(['G90.1', 'G91.1', 'F900', 'M400']);
    expect(resumeTravelMm(program, 3, 7)).toBe(0);
  });

  it('control: linear motion remains measurable while only arc-center mode is untracked', () => {
    const program = knownPointProgram(['G90.1', 'G1 X15', 'G91.1']);
    expect(resumeTravelMm(program, 3, 6)).toBe(5);
  });

  it('control: linear travel still starts only after both XY axes are commanded', () => {
    const program = ['G21 G90 G54', 'G0 X5', 'G0 Y5', 'G1 X10', 'M5'].join('\n');
    expect(resumeTravelMm(program, 1, 5)).toBe(5);
  });

  it('control: an empty span before either XY axis is known still measures zero', () => {
    expect(resumeTravelMm('G21 G90 G54\nM5', 1, 1)).toBe(0);
    expect(resumeEntryPointMm('G21 G90 G54\nM5', 1)).toBeNull();
  });

  it('control: legacy endpoint scanning keeps the commanded endpoint under G90.1', () => {
    // The distance qualification must not expand the legacy modal endpoint
    // helper's refusal policy. A center-mode change does not alter the XY words.
    const program = knownPointProgram(['G90.1', 'G2 X20 Y30 I20 J20']);
    expect(resumeEntryPointMm(program, 5)).toEqual({ x: 20, y: 30 });
  });
});
