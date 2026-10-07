import { describe, expect, it } from 'vitest';
import { resumeEntryPointMm, resumeTravelMm } from './resume-program';

const PREFIX = ['G21 G90 G54', 'G0 X10 Y20'];
const quarter = (before: string, block: string) => [...PREFIX, before, block, 'M5'].join('\n');

describe('R1 whole-block distance qualification', () => {
  it.each([
    { name: 'XY plane before the arc', block: 'G17 G91.1 G2 X20 Y30 I10 J0' },
    { name: 'XY plane after the geometry', block: 'G91.1 G2 X20 Y30 I10 J0 G17' },
    { name: 'incremental center mode after the geometry', block: 'G2 X20 Y30 I10 J0 G17 G91.1' },
  ])('uses the final block modes: $name', ({ block }) => {
    const program = quarter('G18 G90.1', block);
    expect(resumeTravelMm(program, 4, 5)).toBeCloseTo(5 * Math.PI, 9);
  });

  it.each([
    { name: 'non-XY plane after the geometry', block: 'G2 X20 Y30 I10 J0 G18' },
    { name: 'absolute center mode after the geometry', block: 'G2 X20 Y30 I10 J0 G90.1' },
  ])('rejects an unqualified final mode: $name', ({ block }) => {
    expect(resumeTravelMm(quarter('G17', block), 4, 5)).toBeNull();
  });

  it('uses an explicit linear selector after endpoint words rather than the prior arc mode', () => {
    const program = [...PREFIX, 'G2 X20 Y30 I10 J0', 'X25 Y30 G1', 'M5'].join('\n');
    expect(resumeTravelMm(program, 4, 5)).toBe(5);
    expect(resumeEntryPointMm(program, 5)).toEqual({ x: 25, y: 30 });
  });

  it('does not assign a distance to duplicate arc addresses', () => {
    expect(resumeTravelMm(quarter('G17', 'G2 X20 Y30 I10 I9 J0'), 4, 5)).toBeNull();
  });

  it.each([
    { name: 'conflicting motion selectors', block: 'G2 G3 X20 Y30 I10 J0' },
    { name: 'unknown numeric address', block: 'G2 X20 Y30 I10 J0 Q1' },
    { name: 'dwell consumes parameters', block: 'G4 P2 I10' },
    { name: 'planner barrier consumes parameters', block: 'M400 I10' },
  ])('does not infer motion from an ambiguous block: $name', ({ block }) => {
    const program = [...PREFIX, 'G2 X20 Y30 I10 J0', block, 'M5'].join('\n');
    expect(resumeTravelMm(program, 4, 5)).toBeNull();
  });

  it('rejects an arc endpoint at its center even inside the rounding tolerance', () => {
    expect(resumeTravelMm(quarter('G17', 'G2 X10.001 Y20 I0.001'), 4, 5)).toBeNull();
  });

  it('rejects distinct endpoints whose huge-radius angle arithmetic collapses', () => {
    const hugeRadius = `1${'0'.repeat(307)}`;
    expect(resumeTravelMm(quarter('G17', `G2 X11 Y20 I${hugeRadius}`), 4, 5)).toBeNull();
  });

  it('does not silently qualify a later span through an invalid earlier arc', () => {
    const program = [...PREFIX, 'G2 X20 Y30 I5', 'G1 X25 Y30', 'M5'].join('\n');
    expect(resumeTravelMm(program, 4, 5)).toBeNull();
  });

  describe('arc-local P qualification', () => {
    const parameters = ['G2', 'G3'].flatMap((motion) =>
      ['IJ', 'R'].flatMap((form) =>
        [1, 2].map((turns) => ({
          name: `${motion}, ${form}, P${turns}`,
          block: `${motion} X20 Y${motion === 'G2' ? 30 : 10} ${form === 'IJ' ? 'I10 J0' : 'R10'} P${turns}`,
        })),
      ),
    );

    it.each(parameters)('returns unknown for untracked arc-local P: $name', ({ block }) => {
      expect(resumeTravelMm(quarter('G17', block), 4, 5)).toBeNull();
    });

    it.each(['G2', 'G3'])('rejects P on a modal %s endpoint block', (motion) => {
      const clockwise = motion === 'G2';
      const program = [
        ...PREFIX,
        `${motion} X20 Y${clockwise ? 30 : 10} I10 J0`,
        `X30 Y20 I0 J${clockwise ? -10 : 10} P2`,
        'M5',
      ].join('\n');
      expect(resumeTravelMm(program, 4, 5)).toBeNull();
    });

    it('does not qualify an axis-free P block under carried arc mode as zero movement', () => {
      const program = [...PREFIX, 'G2 X20 Y30 I10 J0', 'P2', 'M5'].join('\n');
      expect(resumeTravelMm(program, 4, 5)).toBeNull();
    });

    it.each(['G4 P2', 'M221 P0 S100'])(
      'control: %s consumes its own P parameter under carried G2 mode',
      (block) => {
        const program = [...PREFIX, 'G2 X20 Y30 I10 J0', block, 'M5'].join('\n');
        expect(resumeTravelMm(program, 4, 5)).toBe(0);
      },
    );
  });

  it('retains the native axis-free beam and inline-flag grammar without adding movement', () => {
    const program = [
      ...PREFIX,
      'G2 X20 Y30 I10 J0',
      'M3 I',
      'M5 I',
      'fire off',
      'M106 S0',
      'M107',
      'M221 S100',
      'M400',
    ].join('\n');
    expect(resumeTravelMm(program, 4, 11)).toBe(0);
  });
});
