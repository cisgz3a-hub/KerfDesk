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

  it.each([
    'G21 G90 G54\nG0 X25.4 Y50.8\nG20\nG1 X2\nM5',
    'G20 G90 G54\nG0 X1 Y2\nG21\nG1 X50.8\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG10 L2 P2 X100 Y200\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG55\nG0 X30 Y40\nG54\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG92.1\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG38.2 X30\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG4 X1\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG1 X.5\nM5',
    'G21 G90 G54\nG0 X10 Y20\nG1 X+5\nM5',
    'G21 G90 G54\nG0 X10 Y20\nM6\nM5',
    'G21 G90 G54\nG0 X10 Y20\nM428\nM5',
  ])('does not offer an unproved point after coordinate/modal constructs: %s', (program) => {
    expect(resumeEntryPointMm(program, program.split('\n').length)).toBeNull();
  });

  it('keeps known points across ordinary dwell, power and feed blocks', () => {
    const program = 'G21 G90 G54\nG0 X10 Y20\nG4 P1\nM8\nF500 S0\nG1 X30\nM5';
    expect(resumeEntryPointMm(program, 6)).toEqual({ x: 10, y: 20 });
    expect(resumeEntryPointMm(program, 7)).toEqual({ x: 30, y: 20 });
  });

  it.each([
    'M5 I\nG21 G90\nM3 I S0\nG0 X10 Y20\nG1 X30 S100\nM5 I',
    'M107\nG21 G90\nG0 X10 Y20\nM106 S100\nG1 X30\nM107',
    'fire off\nG21 G90\nG0 X10 Y20\nM400\nM221 S100 P0\nG1 X30 S0.5\nM400',
  ])('retains normal generated native laser power syntax: %s', (program) => {
    expect(resumeEntryPointMm(program, program.split('\n').length)).toEqual({ x: 30, y: 20 });
  });

  it('is null for a program it cannot follow or one in another work coordinate system', () => {
    expect(resumeEntryPointMm('G21 G91\nG0 X1 Y1\nG1 X1\n', 3)).toBeNull();
    expect(resumeEntryPointMm('G21 G90 G55\nG0 X1 Y1\nG1 X1\n', 3)).toBeNull();
    expect(resumeEntryPointMm(PROGRAM, 0)).toBeNull();
    expect(resumeEntryPointMm(PROGRAM, 99)).toBeNull();
  });
});
