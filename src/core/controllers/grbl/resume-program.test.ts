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
