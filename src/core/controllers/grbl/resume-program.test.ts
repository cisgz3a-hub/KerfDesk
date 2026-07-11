// Start-from-line recovery (ADR-103 G7): modal-state replay, safe re-entry
// preamble, and refusals.

import { describe, expect, it } from 'vitest';
import { buildResumeProgram, type ResumeOptions } from './resume-program';

const OPTIONS: ResumeOptions = { safeZMm: 5, spindleSpinupSec: 3, plungeMmPerMin: 300 };

const PROGRAM = [
  'G21',
  'G90',
  'M3 S12000',
  'G4 P3.000',
  'G0 Z5.000',
  'G0 X10.000 Y20.000',
  'G1 Z-2.000 F300.000',
  'G1 X50.000 F1000.000',
  'G1 Y40.000',
  'G1 X10.000',
  'G0 Z5.000',
  'M5',
  'G0 X0.000 Y0.000',
].join('\n');

describe('buildResumeProgram', () => {
  it('rebuilds units, spindle, position, depth, and feed for a mid-cut resume', () => {
    // Resume at line 9 (G1 Y40) — the machine was at X50 Y20 Z-2, F1000.
    const result = buildResumeProgram(PROGRAM, 9, OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.lines.slice(0, result.preambleCount)).toEqual([
      '; KerfDesk resume preamble',
      'G21',
      'G90',
      'M3 S12000',
      'G4 P3.000',
      'G0 Z5',
      'G0 X50 Y20',
      'G1 Z-2 F300',
      'F1000',
    ]);
    expect(result.lines[result.preambleCount]).toBe('G1 Y40.000');
    expect(result.lines.at(-1)).toBe('G0 X0.000 Y0.000');
  });

  it("re-enters at the job's real plunge feed, not the hard-coded fallback (CNC-07)", () => {
    // The interrupted job plunged at F250; the fallback option is 300. Resume
    // must descend at the recorded 250, not the fallback, or it re-engages the
    // stock far faster than the job was cut.
    const program = [
      'G21', // 1
      'G90', // 2
      'M3 S12000', // 3
      'G0 Z5', // 4
      'G0 X10 Y20', // 5
      'G1 Z-1.5 F250', // 6  plunge at 250 (Z + F, no X/Y)
      'G1 X30 Y20 F800', // 7  cut (feed 800)
      'G1 X30 Y40', // 8  resume here
    ].join('\n');
    const result = buildResumeProgram(program, 8, { ...OPTIONS, plungeMmPerMin: 300 });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    // formatNumber renders a non-integer Z with 3 decimals (-1.5 -> -1.500).
    expect(preamble).toContain('G1 Z-1.500 F250');
    expect(preamble).not.toContain('G1 Z-1.500 F300');
  });

  it('recovers the plunge feed from a ramp/relief move (X/Y/Z/F), not the fallback (Codex audit)', () => {
    // A relief/ramp program plunges with `G1 X Y Z F` (no pure-Z line). Its F is
    // the real plunge feed — re-entry must use it, not the faster fallback that
    // would drive the tool back into the stock too hard.
    const program = [
      'G21', // 1
      'G90', // 2
      'M3 S12000', // 3
      'G0 Z5', // 4
      'G0 X10 Y20', // 5
      'G1 X15 Y25 Z-1 F400', // 6  ramp lowers Z 5 -> -1 at F400
      'G1 X30 Y40', // 7  resume here
    ].join('\n');
    const result = buildResumeProgram(program, 7, { ...OPTIONS, plungeMmPerMin: 300 });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    expect(preamble).toContain('G1 Z-1 F400');
    expect(preamble).not.toContain('G1 Z-1 F300');
  });

  it('never lets an upward retract or a G0 rapid hijack the plunge feed', () => {
    // After a real F250 plunge, a fast upward retract (F3000) and a rapid must
    // not overwrite the remembered downward feed.
    const program = [
      'G21', // 1
      'G90', // 2
      'M3 S12000', // 3
      'G0 Z5', // 4
      'G1 Z-1.5 F250', // 5  plunge down at 250
      'G1 Z8 F3000', // 6  retract UP at 3000 — must not become the plunge
      'G0 Z-2 F9000', // 7  rapid down with F — G0 ignores F, must not record
      'G0 X30 Y40', // 8  reposition
      'G1 X40 Y40 F800', // 9  resume here (cut)
    ].join('\n');
    const result = buildResumeProgram(program, 9, { ...OPTIONS, plungeMmPerMin: 300 });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    // The Z-descent re-entry uses the real downward plunge feed (250) — never the
    // upward retract (3000) or the rapid's F word (9000). (Restoring 9000 as the
    // bare modal feed afterward is correct and separate.)
    expect(preamble.some((line) => /^G1 Z.* F250$/.test(line))).toBe(true);
    expect(preamble.some((line) => /^G1 Z.* F(3000|9000)$/.test(line))).toBe(false);
  });

  it('positions the head before arming the laser on a Z-free (laser) resume', () => {
    // A laser program has no Z words and carries S/F modally. Resuming mid-path
    // must travel to the resume XY with the beam OFF, then arm — never
    // arm-then-travel. Under M3 constant power in GRBL laser mode, an early
    // `M3 S<power>` (and the spin-up G4 dwell) fires a stationary dot at the
    // parked position and then travels with the beam armed (audit C1).
    const laser =
      'G21\nG90\nM3 S0\nG0 X10 Y10 S0\nG1 X20 Y10 F1500 S300\nG1 X20 Y20\nG1 X10 Y20\nM5';
    const result = buildResumeProgram(laser, 6, OPTIONS); // resume at 'G1 X20 Y20'
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    const moveIndex = preamble.findIndex((line) => line.startsWith('G0 X'));
    const armIndex = preamble.findIndex((line) => line.startsWith('M3 S'));
    expect(moveIndex).toBeGreaterThanOrEqual(0);
    expect(armIndex).toBeGreaterThan(moveIndex);
    // No spin-up dwell on a laser resume — a G4 while M3 is active fires the
    // stationary beam.
    expect(preamble.some((line) => line.startsWith('G4'))).toBe(false);
  });

  it('leaves the spindle off when it was off at the resume point', () => {
    const result = buildResumeProgram(PROGRAM, 2, OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    expect(preamble.some((line) => line.startsWith('M3'))).toBe(false);
    expect(preamble.some((line) => line.startsWith('G4'))).toBe(false);
  });

  it('does not feed down when the recorded Z is at/above safe height', () => {
    // Resume at line 7 (the plunge itself): last Z seen is +5.
    const result = buildResumeProgram(PROGRAM, 7, OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    expect(preamble.some((line) => line.startsWith('G1 Z'))).toBe(false);
  });

  it('refuses out-of-range lines, G91 programs, and empty tails', () => {
    expect(buildResumeProgram(PROGRAM, 0, OPTIONS).kind).toBe('error');
    expect(buildResumeProgram(PROGRAM, 999, OPTIONS).kind).toBe('error');
    const relative = 'G21\nG91\nG1 X5 F100\nG1 X5';
    const refused = buildResumeProgram(relative, 4, OPTIONS);
    expect(refused.kind).toBe('error');
    if (refused.kind === 'error') expect(refused.reason).toMatch(/G91/);
    const emptyTail = buildResumeProgram('G21\nG1 X5 F100\n; done\n', 3, OPTIONS);
    expect(emptyTail.kind).toBe('error');
  });

  // Audit F11: G53/G28/G30 change position without touching the tracked
  // X/Y/Z modal words, so the replayed re-entry would target the wrong
  // point. KerfDesk's emitters never produce them; imported G-code can.
  it('refuses programs with G53/G28/G30 before the resume point', () => {
    const withG53 = 'G21\nG90\nG53 G0 Z-5\nG1 X5 F100\nG1 X6';
    const g53 = buildResumeProgram(withG53, 5, OPTIONS);
    expect(g53.kind).toBe('error');
    if (g53.kind === 'error') expect(g53.reason).toMatch(/G53/);

    const withG28 = 'G21\nG90\nG28 X0\nG1 X5 F100\nG1 X6';
    const g28 = buildResumeProgram(withG28, 5, OPTIONS);
    expect(g28.kind).toBe('error');
    if (g28.kind === 'error') expect(g28.reason).toMatch(/G28/);

    const withG30 = 'G21\nG90\nG30\nG1 X5 F100\nG1 X6';
    expect(buildResumeProgram(withG30, 5, OPTIONS).kind).toBe('error');
  });

  it('ignores comments and percent markers while scanning', () => {
    const withComments = 'G21\n(header) G90\n; note\nM3 S5000\nG1 X1 Y1 F500\nG1 X2';
    const result = buildResumeProgram(withComments, 6, OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.lines.slice(0, result.preambleCount)).toContain('M3 S5000');
  });
});
