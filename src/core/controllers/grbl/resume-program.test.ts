// Laser start-from-line recovery and the CNC automatic-recovery kill switch
// (ADR-103 G7, ADR-141).

import { describe, expect, it } from 'vitest';
import {
  buildResumeProgram,
  CNC_AUTOMATIC_RECOVERY_DISABLED_REASON,
  type ResumeOptions,
} from './resume-program';

const LASER_OPTIONS: ResumeOptions = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
};
const CNC_OPTIONS: ResumeOptions = {
  ...LASER_OPTIONS,
  machineKind: 'cnc',
  safeZMm: 5,
  spindleSpinupSec: 3,
};

describe('buildResumeProgram', () => {
  it('refuses every CNC automatic resume before parsing or emitting motion', () => {
    const result = buildResumeProgram('G91\nM3 S12000\nG1 Z-5', 999, CNC_OPTIONS);

    expect(result).toEqual({
      kind: 'error',
      reason: CNC_AUTOMATIC_RECOVERY_DISABLED_REASON,
    });
    expect(CNC_AUTOMATIC_RECOVERY_DISABLED_REASON).toMatch(/acknowledgements do not prove/i);
    expect(CNC_AUTOMATIC_RECOVERY_DISABLED_REASON).toMatch(/cutter is clear/i);
  });

  it('positions the head before arming the laser on a Z-free resume', () => {
    const laser =
      'G21\nG90\nM3 S0\nG0 X10 Y10 S0\nG1 X20 Y10 F1500 S300\nG1 X20 Y20\nG1 X10 Y20\nM5';
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    const moveIndex = preamble.findIndex((line) => line.startsWith('G0 X'));
    const armIndex = preamble.findIndex((line) => line.startsWith('M3 S'));

    expect(moveIndex).toBeGreaterThanOrEqual(0);
    expect(armIndex).toBeGreaterThan(moveIndex);
    expect(preamble.some((line) => line.startsWith('G4'))).toBe(false);
    expect(preamble.some((line) => /\bZ-?\d/.test(line))).toBe(false);
    expect(result.fromLine).toBe(6);
    expect(result.lines[result.preambleCount]).toBe('G1 X20 Y20');
  });

  it('refuses out-of-range lines, G91 programs, and empty tails for laser recovery', () => {
    const program = 'G21\nG90\nG1 X5 F100\nG1 X6';
    expect(buildResumeProgram(program, 0, LASER_OPTIONS).kind).toBe('error');
    expect(buildResumeProgram(program, 999, LASER_OPTIONS).kind).toBe('error');

    const relative = 'G21\nG91\nG1 X5 F100\nG1 X5';
    const refused = buildResumeProgram(relative, 4, LASER_OPTIONS);
    expect(refused.kind).toBe('error');
    if (refused.kind === 'error') expect(refused.reason).toMatch(/G91/);

    const emptyTail = buildResumeProgram('G21\nG1 X5 F100\n; done\n', 3, LASER_OPTIONS);
    expect(emptyTail.kind).toBe('error');
  });

  it('refuses programs with G53/G28/G30 before the laser resume point', () => {
    const withG53 = 'G21\nG90\nG53 G0 Z-5\nG1 X5 F100\nG1 X6';
    const g53 = buildResumeProgram(withG53, 5, LASER_OPTIONS);
    expect(g53.kind).toBe('error');
    if (g53.kind === 'error') expect(g53.reason).toMatch(/G53/);

    const withG28 = 'G21\nG90\nG28 X0\nG1 X5 F100\nG1 X6';
    const g28 = buildResumeProgram(withG28, 5, LASER_OPTIONS);
    expect(g28.kind).toBe('error');
    if (g28.kind === 'error') expect(g28.reason).toMatch(/G28/);

    const withG30 = 'G21\nG90\nG30\nG1 X5 F100\nG1 X6';
    expect(buildResumeProgram(withG30, 5, LASER_OPTIONS).kind).toBe('error');
  });

  it('ignores comments and percent markers while scanning laser modal state', () => {
    const withComments = 'G21\n(header) G90\n; note\nM3 S5000\nG1 X1 Y1 F500\nG1 X2';
    const result = buildResumeProgram(withComments, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);

    expect(result.lines.slice(0, result.preambleCount)).toContain('M3 S5000');
  });
});
