// Laser start-from-line recovery and the CNC automatic-recovery kill switch
// (ADR-103 G7, ADR-141).

import { describe, expect, it } from 'vitest';
import { findLaserOnTravelIssues } from '../../invariants';
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

  it('hard-offs before a Z-free re-entry and restores power on the first burn move', () => {
    const laser =
      'G21\nG90\nM3 S0\nG0 X10 Y10 S0\nG1 X20 Y10 F1500 S300\nG1 X20 Y20\nG1 X10 Y20\nM5';
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    const hardOffIndex = preamble.indexOf('M5');
    const moveIndex = preamble.findIndex((line) => line.startsWith('G0 X'));
    const armIndex = preamble.findIndex((line) => line.startsWith('M3 S'));

    expect(hardOffIndex).toBeGreaterThanOrEqual(0);
    expect(hardOffIndex).toBeLessThan(moveIndex);
    expect(moveIndex).toBeGreaterThanOrEqual(0);
    expect(preamble[moveIndex]).toBe('G0 X20 Y10 S0');
    expect(armIndex).toBeGreaterThan(moveIndex);
    expect(preamble[armIndex]).toBe('M3 S0');
    expect(preamble.some((line) => line.startsWith('G4'))).toBe(false);
    expect(preamble.some((line) => /\bZ-?\d/.test(line))).toBe(false);
    // WCS + feed mode are pinned before the re-entry move (F10/F41/F50).
    expect(preamble).toContain('G54');
    expect(preamble).toContain('G94');
    expect(preamble.indexOf('G54')).toBeLessThan(moveIndex);
    expect(result.fromLine).toBe(6);
    expect(result.lines[result.preambleCount]).toBe('G1 X20 Y20 S300');
    expect(findLaserOnTravelIssues(result.lines.join('\n'))).toEqual([]);
  });

  // C8: an imported program that selects G55-G59 before the resume line must
  // resume in THAT frame. The preamble previously hard-pinned G54, so a G55
  // program would replay the whole tail in the wrong coordinate system. (Unreachable
  // today — resume is laser-only and imported programs are preview-only — but a
  // latent wrong-frame-motion hazard the day imported streaming ships.)
  it('preserves the program-selected work coordinate system in the resume preamble', () => {
    const laser = 'G21\nG90\nG55\nM3 S0\nG0 X10 Y10 S0\nG1 X20 Y10 F1500 S300\nG1 X20 Y20\nM5';
    const result = buildResumeProgram(laser, 7, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);
    const moveIndex = preamble.findIndex((line) => line.startsWith('G0 X'));

    expect(preamble).toContain('G55');
    expect(preamble).not.toContain('G54');
    expect(preamble.indexOf('G55')).toBeLessThan(moveIndex);
  });

  it('defaults the resume preamble to G54 when the program selects no WCS', () => {
    const laser = 'G21\nG90\nM3 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F1500 S300\nM5';
    const result = buildResumeProgram(laser, 5, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);

    expect(preamble).toContain('G54');
    expect(preamble.filter((line) => /^G5[4-9]$/.test(line))).toEqual(['G54']);
  });

  it('restores dynamic M4 power only on the first resumed burn move', () => {
    const laser = 'G21\nG90\nM4 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F1500 S300\nG1 X20 Y0\nM5';
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const preamble = result.lines.slice(0, result.preambleCount);

    expect(preamble).toContain('M5');
    expect(preamble).toContain('G0 X10 Y0 S0');
    expect(preamble).toContain('M4 S0');
    expect(preamble).not.toContain('M4 S300');
    expect(result.lines[result.preambleCount]).toBe('G1 X20 Y0 S300');
  });

  it('moves every stationary positive arm onto its following burn motion', () => {
    const laser = [
      'G21',
      'G90',
      'M3 S0',
      'G0 X0 Y0 S0',
      'G1 X1 Y0 F1000 S200',
      'M5',
      'M4 S400',
      'G0 X2 Y0 S400',
      'G1 X3 Y0',
      'M3 S500',
      'G1 X4 Y0',
      'M5',
    ].join('\n');
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const tail = result.lines.slice(result.preambleCount);

    expect(tail).toEqual([
      'M5',
      'M4 S0',
      'G0 X2 Y0 S0',
      'G1 X3 Y0 S400',
      'M3 S0',
      'G1 X4 Y0 S500',
      'M5',
    ]);
  });

  it('does not restore stale power after an explicit S0 motion', () => {
    const laser =
      'G21\nG90\nM3 S0\nG0 X0 Y0 S0\nG1 X1 Y0 F1000 S200\nG1 X2 Y0 S0\nG1 X3 Y0\nG1 X4 Y0 S200\nM5';
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);

    expect(result.lines.slice(result.preambleCount)).toEqual([
      'G1 X2 Y0 S0',
      'G1 X3 Y0',
      'G1 X4 Y0 S200',
      'M5',
    ]);
  });

  it('does not mistake a coordinate-setting line for resumed burn motion', () => {
    const laser = 'G21\nG90\nM3 S0\nG0 X0 Y0 S0\nG1 X1 Y0 F1000 S200\nG92 X0\nG1 X2 Y0\nM5';
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);

    expect(result.lines.slice(result.preambleCount)).toEqual(['G92 X0', 'G1 X2 Y0 S200', 'M5']);
  });

  it('restores power on a full-circle arc with no repeated X/Y endpoint', () => {
    const laser = 'G21\nG90\nM4 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F1000 S200\nG2 I-5 J0\nM5';
    const result = buildResumeProgram(laser, 6, LASER_OPTIONS);
    if (result.kind !== 'ok') throw new Error(result.reason);

    expect(result.lines[result.preambleCount]).toBe('G2 I-5 J0 S200');
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

    expect(result.lines.slice(0, result.preambleCount)).toContain('M3 S0');
    expect(result.lines[result.preambleCount]).toBe('G1 X2 S5000');
  });
});
