// Where the program's head stands when a replay reaches a line (ADR-341
// Amendment 6): continuing after a lost link sets the origin from it.

import { describe, expect, it } from 'vitest';
import { resumeEntryPointMm } from './resume-program';

const PROGRAM = [
  'G21 G90 G54',
  'M4 S0',
  'G0 X10 Y20',
  'G1 X15.5 S300 F3000',
  '; a comment moves nothing',
  'Y22.25',
  'G1 X5 Y22.25',
  'M5',
].join('\n');

describe('resumeEntryPointMm', () => {
  it('is the end point of the last move before the line', () => {
    expect(resumeEntryPointMm(PROGRAM, 4)).toEqual({ x: 10, y: 20 });
    expect(resumeEntryPointMm(PROGRAM, 5)).toEqual({ x: 15.5, y: 20 });
    expect(resumeEntryPointMm(PROGRAM, 6)).toEqual({ x: 15.5, y: 20 });
    expect(resumeEntryPointMm(PROGRAM, 7)).toEqual({ x: 15.5, y: 22.25 });
    expect(resumeEntryPointMm(PROGRAM, 8)).toEqual({ x: 5, y: 22.25 });
  });

  it('is null before the program has commanded both X and Y', () => {
    expect(resumeEntryPointMm(PROGRAM, 1)).toBeNull();
    expect(resumeEntryPointMm('G21 G90\nG0 X4\nG1 X8 S100\n', 3)).toBeNull();
  });

  it('converts an inch program to millimetres', () => {
    expect(resumeEntryPointMm('G20 G90 G54\nG0 X1 Y2\nG1 X3\n', 3)).toEqual({
      x: 25.4,
      y: 50.8,
    });
  });

  it('is null for a program it cannot follow or one in another work coordinate system', () => {
    expect(resumeEntryPointMm('G21 G91\nG0 X1 Y1\nG1 X1\n', 3)).toBeNull();
    expect(resumeEntryPointMm('G21 G90 G55\nG0 X1 Y1\nG1 X1\n', 3)).toBeNull();
    expect(resumeEntryPointMm(PROGRAM, 0)).toBeNull();
    expect(resumeEntryPointMm(PROGRAM, 99)).toBeNull();
  });
});
