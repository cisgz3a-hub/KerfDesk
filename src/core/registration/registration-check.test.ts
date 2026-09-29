import { describe, expect, it } from 'vitest';
import { checkTwoPointRegistration, registrationFigures } from './registration-check';
import { solveTwoPointRegistration } from './similarity-transform';

const design = [
  { x: 20, y: 20 },
  { x: 180, y: 20 },
] as const;

describe('checkTwoPointRegistration', () => {
  it('says how far apart and how turned the captured points are', () => {
    const checked = checkTwoPointRegistration({
      design,
      machine: [
        { x: 25, y: 22 },
        { x: 185.08, y: 24.8 },
      ],
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.measured).toBe(
      'The captured points are 160.1 mm apart (designed 160.0 mm, print scale +0.07 %), turned 1.0°.',
    );
    expect(checked.unusual).toBeNull();
  });

  it('asks to confirm a print scale more than 2 % off', () => {
    // Marks 20 mm apart, each jog 0.3 mm off outward: 3 % larger, 4.5 mm off 150 mm away.
    const checked = checkTwoPointRegistration({
      design: [
        { x: 100, y: 20 },
        { x: 120, y: 20 },
      ],
      machine: [
        { x: 99.7, y: 20 },
        { x: 120.3, y: 20 },
      ],
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.measured).toContain('print scale +3.00 %');
    expect(checked.unusual).toBe(
      'A print scale more than 2 % off is not the printer: a capture may be off its mark.',
    );
  });

  it('asks to confirm a turn near 180°, which the targets captured in the swapped order give', () => {
    const checked = checkTwoPointRegistration({ design, machine: [design[1], design[0]] });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.measured).toContain('turned 180.0°');
    expect(checked.unusual).toBe(
      'A turn near 180° is what capturing the two targets in the swapped order gives.',
    );
  });

  it('accepts a sheet laid a quarter turn round at its printed size', () => {
    const checked = checkTwoPointRegistration({
      design,
      machine: [
        { x: 200, y: 50 },
        { x: 200, y: 210 },
      ],
    });
    expect(checked.ok && checked.unusual).toBeNull();
    expect(checked.ok && checked.measured).toContain('turned 90.0°');
  });

  it('asks to confirm targets or captures closer than 10 mm, such as one mark captured twice', () => {
    // The same printed mark captured twice, the second jog 0.4 mm off: the
    // solve shrinks the job to 0.25 % without a word.
    const twice = checkTwoPointRegistration({
      design,
      machine: [
        { x: 52.1, y: 61.3 },
        { x: 52.5, y: 61.3 },
      ],
    });
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.measured).toContain('0.4 mm apart');
    expect(twice.unusual).toContain('Targets closer than 10 mm cannot fix the scale and turn');
    const close = checkTwoPointRegistration({
      design: [
        { x: 0, y: 0 },
        { x: 9.9, y: 0 },
      ],
      machine: [
        { x: 0, y: 0 },
        { x: 9.9, y: 0 },
      ],
    });
    expect(close.ok && close.unusual).toContain('Targets closer than 10 mm');
    const apart = checkTwoPointRegistration({
      design: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      machine: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
      ],
    });
    expect(apart.ok && apart.unusual).toBeNull();
  });

  it('still refuses only targets that coincide, where no transform exists', () => {
    const same = checkTwoPointRegistration({ design: [design[0], design[0]], machine: design });
    expect(same).toEqual({ ok: false, reason: 'Registration targets must be distinct.' });
  });

  it('reads the same figures back from a solved transform', () => {
    const machine = [
      { x: 25, y: 22 },
      { x: 185.08, y: 24.8 },
    ] as const;
    const solved = solveTwoPointRegistration({ design, machine });
    if (!solved.ok) throw new Error(solved.reason);
    const checked = checkTwoPointRegistration({ design, machine });
    expect(registrationFigures(design, solved.transform)).toEqual({
      measured: checked.ok ? checked.measured : null,
      unusual: null,
    });
  });
});
